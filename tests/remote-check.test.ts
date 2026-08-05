import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { checkRemoteConflicts, conflictsOf, unverifiedOf } from "../src/actions/remote-check.js";
import type { HsAccount } from "../src/hs/accounts.js";
import type { RemoteEntry } from "../src/hs/remote-ls.js";
import { recordRemoteFiles, saveRemoteState, sha256 } from "../src/state/remote-state.js";

const account: HsAccount = { name: "example", accountId: "123456", isDefault: true };

const SCOPE = "src/example-123456";

async function createWorkspace(files: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "hsdm-remote-check-"));
  for (const [file, content] of Object.entries(files)) {
    const absolute = join(cwd, file);
    await mkdir(join(absolute, ".."), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }
  return cwd;
}

function listing(names: string[]): RemoteEntry[] {
  return names.map((name) => ({ name, kind: "file" as const }));
}

describe("checkRemoteConflicts", () => {
  it("flags a remote that moved away from the recorded sync", async () => {
    const cwd = await createWorkspace({ [`${SCOPE}/theme/main.css`]: "my local edit" });
    await saveRemoteState(
      recordRemoteFiles({ files: {} }, "example-123456", [
        { remotePath: "/theme/main.css", sha256: sha256("fetched version") },
      ]),
      cwd
    );

    const results = await checkRemoteConflicts(account, [`${SCOPE}/theme/main.css`], cwd, {
      listRemote: vi.fn().mockResolvedValue(listing(["main.css"])),
      readRemoteFile: vi.fn().mockResolvedValue(Buffer.from("edited in the HubSpot UI")),
    });

    expect(results[0]).toMatchObject({
      file: `${SCOPE}/theme/main.css`,
      remotePath: "/theme/main.css",
      check: { status: "conflict" },
    });
    expect(conflictsOf(results)).toHaveLength(1);
  });

  it("is safe when the remote still matches the recorded sync", async () => {
    const cwd = await createWorkspace({ [`${SCOPE}/theme/main.css`]: "my local edit" });
    await saveRemoteState(
      recordRemoteFiles({ files: {} }, "example-123456", [
        { remotePath: "/theme/main.css", sha256: sha256("fetched version") },
      ]),
      cwd
    );

    const results = await checkRemoteConflicts(account, [`${SCOPE}/theme/main.css`], cwd, {
      listRemote: vi.fn().mockResolvedValue(listing(["main.css"])),
      readRemoteFile: vi.fn().mockResolvedValue(Buffer.from("fetched version")),
    });

    expect(results[0]?.check.status).toBe("safe");
  });

  it("does not download files that are not on HubSpot yet", async () => {
    const cwd = await createWorkspace({ [`${SCOPE}/theme/new.css`]: "brand new" });
    const readRemoteFile = vi.fn();

    const results = await checkRemoteConflicts(account, [`${SCOPE}/theme/new.css`], cwd, {
      listRemote: vi.fn().mockResolvedValue(listing(["main.css"])),
      readRemoteFile,
    });

    expect(results[0]?.check).toMatchObject({ status: "safe", reason: "not on HubSpot yet" });
    expect(readRemoteFile).not.toHaveBeenCalled();
  });

  it("treats a matching remote as identical even without a sync record", async () => {
    const cwd = await createWorkspace({ [`${SCOPE}/theme/main.css`]: "same bytes" });

    const results = await checkRemoteConflicts(account, [`${SCOPE}/theme/main.css`], cwd, {
      listRemote: vi.fn().mockResolvedValue(listing(["main.css"])),
      readRemoteFile: vi.fn().mockResolvedValue(Buffer.from("same bytes")),
    });

    expect(results[0]?.check.status).toBe("identical");
  });

  it("reports unverified when the listing or the download fails", async () => {
    const cwd = await createWorkspace({
      [`${SCOPE}/a/one.css`]: "one",
      [`${SCOPE}/b/two.css`]: "two",
    });

    const results = await checkRemoteConflicts(account, [`${SCOPE}/a/one.css`, `${SCOPE}/b/two.css`], cwd, {
      listRemote: vi.fn(async (_accountId: string, path: string) =>
        path === "/a" ? undefined : listing(["two.css"])
      ),
      readRemoteFile: vi.fn().mockResolvedValue(undefined),
    });

    expect(unverifiedOf(results)).toHaveLength(2);
    expect(results[0]?.check.reason).toBe("remote copy could not be read");
  });

  it("lists each remote directory once and reports progress", async () => {
    const cwd = await createWorkspace({
      [`${SCOPE}/theme/one.css`]: "one",
      [`${SCOPE}/theme/two.css`]: "two",
    });
    const listRemote = vi.fn().mockResolvedValue(listing(["one.css", "two.css"]));
    const onProgress = vi.fn();

    await checkRemoteConflicts(account, [`${SCOPE}/theme/one.css`, `${SCOPE}/theme/two.css`], cwd, {
      listRemote,
      readRemoteFile: vi.fn().mockResolvedValue(Buffer.from("remote")),
      onProgress,
    });

    expect(listRemote).toHaveBeenCalledTimes(1);
    expect(listRemote).toHaveBeenCalledWith("123456", "/theme");
    expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2, `${SCOPE}/theme/two.css`);
  });

  it("marks files outside the portal directory as unverified", async () => {
    const cwd = await createWorkspace({ "other/file.css": "x" });

    const results = await checkRemoteConflicts(account, ["other/file.css"], cwd, {
      listRemote: vi.fn(),
      readRemoteFile: vi.fn(),
    });

    expect(results[0]?.check).toMatchObject({ status: "unverified", reason: "file is outside the portal directory" });
  });
});
