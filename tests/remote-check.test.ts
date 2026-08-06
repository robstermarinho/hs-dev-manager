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

/** Stands in for a portal whose inventory could not be listed. */
function noInventory() {
  return vi.fn().mockResolvedValue(undefined);
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
      fetchRemoteInventory: noInventory(),
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
      fetchRemoteInventory: noInventory(),
    });

    expect(results[0]?.check.status).toBe("safe");
  });

  it("does not download files that are not on HubSpot yet", async () => {
    const cwd = await createWorkspace({ [`${SCOPE}/theme/new.css`]: "brand new" });
    const readRemoteFile = vi.fn();

    const results = await checkRemoteConflicts(account, [`${SCOPE}/theme/new.css`], cwd, {
      listRemote: vi.fn().mockResolvedValue(listing(["main.css"])),
      readRemoteFile,
      fetchRemoteInventory: noInventory(),
    });

    expect(results[0]?.check).toMatchObject({ status: "safe", reason: "not on HubSpot yet" });
    expect(readRemoteFile).not.toHaveBeenCalled();
  });

  it("treats a matching remote as identical even without a sync record", async () => {
    const cwd = await createWorkspace({ [`${SCOPE}/theme/main.css`]: "same bytes" });

    const results = await checkRemoteConflicts(account, [`${SCOPE}/theme/main.css`], cwd, {
      listRemote: vi.fn().mockResolvedValue(listing(["main.css"])),
      readRemoteFile: vi.fn().mockResolvedValue(Buffer.from("same bytes")),
      fetchRemoteInventory: noInventory(),
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
      fetchRemoteInventory: noInventory(),
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
      fetchRemoteInventory: noInventory(),
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
      fetchRemoteInventory: noInventory(),
    });

    expect(results[0]?.check).toMatchObject({ status: "unverified", reason: "file is outside the portal directory" });
  });
});

const SYNCED = new Date("2026-08-05T12:00:00.000Z");

async function workspaceSyncedAt(files: Record<string, string>, remotePaths: string[]): Promise<string> {
  const cwd = await createWorkspace(files);
  await saveRemoteState(
    recordRemoteFiles(
      { files: {} },
      "example-123456",
      remotePaths.map((remotePath) => ({ remotePath, sha256: sha256("synced") })),
      SYNCED
    ),
    cwd
  );
  return cwd;
}

describe("checkRemoteConflicts with the inventory prefilter", () => {
  it("skips the listing and the download when the remote has not moved", async () => {
    const cwd = await workspaceSyncedAt({ [`${SCOPE}/theme/main.css`]: "my local edit" }, ["/theme/main.css"]);
    const listRemote = vi.fn();
    const readRemoteFile = vi.fn();

    const results = await checkRemoteConflicts(account, [`${SCOPE}/theme/main.css`], cwd, {
      listRemote,
      readRemoteFile,
      fetchRemoteInventory: vi
        .fn()
        .mockResolvedValue([{ path: "/theme/main.css", updated: SYNCED.getTime(), kind: "file" }]),
    });

    expect(results[0]?.check).toMatchObject({ status: "safe", reason: "remote unchanged since last sync" });
    expect(listRemote).not.toHaveBeenCalled();
    expect(readRemoteFile).not.toHaveBeenCalled();
  });

  it("downloads only the files the timestamps flag as suspect", async () => {
    const cwd = await workspaceSyncedAt(
      { [`${SCOPE}/theme/quiet.css`]: "local", [`${SCOPE}/theme/touched.css`]: "local" },
      ["/theme/quiet.css", "/theme/touched.css"]
    );
    const readRemoteFile = vi.fn().mockResolvedValue(Buffer.from("edited in the HubSpot UI"));

    const results = await checkRemoteConflicts(
      account,
      [`${SCOPE}/theme/quiet.css`, `${SCOPE}/theme/touched.css`],
      cwd,
      {
        listRemote: vi.fn(),
        readRemoteFile,
        fetchRemoteInventory: vi.fn().mockResolvedValue([
          { path: "/theme/quiet.css", updated: SYNCED.getTime(), kind: "file" },
          { path: "/theme/touched.css", updated: SYNCED.getTime() + 3_600_000, kind: "file" },
        ]),
      }
    );

    expect(results[0]?.check.status).toBe("safe");
    expect(results[1]?.check.status).toBe("conflict");
    expect(readRemoteFile).toHaveBeenCalledTimes(1);
    expect(readRemoteFile).toHaveBeenCalledWith("123456", "/theme/touched.css");
  });

  it("answers for files inside a module using the module's own timestamp", async () => {
    const cwd = await workspaceSyncedAt({ [`${SCOPE}/theme/modules/hero.module/module.html`]: "local" }, [
      "/theme/modules/hero.module/module.html",
    ]);
    const readRemoteFile = vi.fn();

    const results = await checkRemoteConflicts(account, [`${SCOPE}/theme/modules/hero.module/module.html`], cwd, {
      listRemote: vi.fn(),
      readRemoteFile,
      fetchRemoteInventory: vi
        .fn()
        .mockResolvedValue([{ path: "/theme/modules/hero.module", updated: SYNCED.getTime(), kind: "module" }]),
    });

    expect(results[0]?.check).toMatchObject({ status: "safe", reason: "remote unchanged since last sync" });
    expect(readRemoteFile).not.toHaveBeenCalled();
  });

  it("downloads a module file when the module was touched after the sync", async () => {
    const cwd = await workspaceSyncedAt({ [`${SCOPE}/theme/modules/hero.module/module.html`]: "local" }, [
      "/theme/modules/hero.module/module.html",
    ]);
    const readRemoteFile = vi.fn().mockResolvedValue(Buffer.from("remote"));

    const results = await checkRemoteConflicts(account, [`${SCOPE}/theme/modules/hero.module/module.html`], cwd, {
      listRemote: vi.fn(),
      readRemoteFile,
      fetchRemoteInventory: vi.fn().mockResolvedValue([
        { path: "/theme/modules/hero.module", updated: SYNCED.getTime() + 3_600_000, kind: "module" },
      ]),
    });

    expect(results[0]?.check.status).toBe("conflict");
    expect(readRemoteFile).toHaveBeenCalledTimes(1);
  });

  it("still downloads a listed file that has no sync record", async () => {
    const cwd = await createWorkspace({ [`${SCOPE}/theme/main.css`]: "local" });
    const readRemoteFile = vi.fn().mockResolvedValue(Buffer.from("remote"));

    const results = await checkRemoteConflicts(account, [`${SCOPE}/theme/main.css`], cwd, {
      listRemote: vi.fn(),
      readRemoteFile,
      fetchRemoteInventory: vi
        .fn()
        .mockResolvedValue([{ path: "/theme/main.css", updated: SYNCED.getTime(), kind: "file" }]),
    });

    expect(results[0]?.check.status).toBe("unverified");
    expect(readRemoteFile).toHaveBeenCalledTimes(1);
  });

  it("falls back to the directory listing for assets the inventory omits", async () => {
    const cwd = await workspaceSyncedAt({ [`${SCOPE}/theme/images/logo.png`]: "local" }, ["/theme/images/logo.png"]);
    const listRemote = vi.fn().mockResolvedValue(listing(["logo.png"]));
    const readRemoteFile = vi.fn().mockResolvedValue(Buffer.from("local"));

    const results = await checkRemoteConflicts(account, [`${SCOPE}/theme/images/logo.png`], cwd, {
      listRemote,
      readRemoteFile,
      // The inventory knows other files, just not this one.
      fetchRemoteInventory: vi
        .fn()
        .mockResolvedValue([{ path: "/theme/main.css", updated: SYNCED.getTime(), kind: "file" }]),
    });

    expect(listRemote).toHaveBeenCalledWith("123456", "/theme/images");
    expect(results[0]?.check.status).toBe("identical");
  });

  it("asks for the inventory once for the whole selection", async () => {
    const cwd = await workspaceSyncedAt(
      { [`${SCOPE}/theme/a.css`]: "a", [`${SCOPE}/theme/b.css`]: "b" },
      ["/theme/a.css", "/theme/b.css"]
    );
    const fetchInventory = vi.fn().mockResolvedValue([
      { path: "/theme/a.css", updated: SYNCED.getTime(), kind: "file" },
      { path: "/theme/b.css", updated: SYNCED.getTime(), kind: "file" },
    ]);

    await checkRemoteConflicts(account, [`${SCOPE}/theme/a.css`, `${SCOPE}/theme/b.css`], cwd, {
      listRemote: vi.fn(),
      readRemoteFile: vi.fn(),
      fetchRemoteInventory: fetchInventory,
    });

    expect(fetchInventory).toHaveBeenCalledTimes(1);
    expect(fetchInventory).toHaveBeenCalledWith("123456");
  });
});
