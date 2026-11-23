import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runHs: vi.fn() }));

vi.mock("../src/hs/runner.js", () => ({ runHs: mocks.runHs }));

import { checkRemoteDeletions } from "../src/actions/remote-delete.js";
import type { HsAccount } from "../src/hs/accounts.js";
import { deleteRemoteFile, deleteSucceeded } from "../src/hs/remote-delete.js";
import type { RemoteEntry } from "../src/hs/remote-ls.js";
import { recordRemoteFiles, saveRemoteState, sha256 } from "../src/state/remote-state.js";

const account: HsAccount = { name: "example", accountId: "123456", isDefault: true };
const FILE = "src/example-123456/theme/old.css";
const REMOTE = "/theme/old.css";

/** A workspace whose last sync of the file recorded the given content. */
async function workspace(syncedContent?: string, syncedAt: Date = new Date()): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "hsdm-remote-delete-"));
  if (syncedContent !== undefined) {
    await saveRemoteState(
      recordRemoteFiles(
        { files: {} },
        "example-123456",
        [{ remotePath: REMOTE, sha256: sha256(syncedContent) }],
        syncedAt
      ),
      cwd
    );
  }
  return cwd;
}

function listing(names: string[]): RemoteEntry[] {
  return names.map((name) => ({ name, kind: "file" as const }));
}

function noInventory() {
  return vi.fn().mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deleteSucceeded", () => {
  it("accepts only the confirmation line", () => {
    expect(deleteSucceeded('Deleted "/theme/old.css" from account 123456')).toBe(true);
    expect(deleteSucceeded('\u001b[32mDeleted "/theme/old.css" from account example [123456]\u001b[39m')).toBe(true);
    expect(deleteSucceeded('Deleting "/theme/old.css" from account 123456 failed')).toBe(false);
    expect(deleteSucceeded("")).toBe(false);
  });
});

describe("deleteRemoteFile", () => {
  it("runs hs cms delete against the account", async () => {
    mocks.runHs.mockResolvedValue({
      ok: true,
      exitCode: 0,
      stdout: 'Deleted "/theme/old.css" from account 123456',
      stderr: "",
    });

    expect((await deleteRemoteFile("123456", REMOTE)).ok).toBe(true);
    expect(mocks.runHs).toHaveBeenCalledWith(["cms", "delete", REMOTE], { accountId: "123456" });
  });

  it("does not trust the exit code: hs exits 0 when the API call failed", async () => {
    mocks.runHs.mockResolvedValue({
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: 'Deleting "/theme/old.css" from account 123456 failed',
    });

    const result = await deleteRemoteFile("123456", REMOTE);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("failed");
  });
});

describe("checkRemoteDeletions", () => {
  it("is safe when the remote still matches the recorded sync", async () => {
    const cwd = await workspace("synced");

    const results = await checkRemoteDeletions(account, [FILE], cwd, {
      listRemote: vi.fn().mockResolvedValue(listing(["old.css"])),
      readRemoteFile: vi.fn().mockResolvedValue(Buffer.from("synced")),
      fetchRemoteInventory: noInventory(),
    });

    expect(results).toEqual([
      { file: FILE, remotePath: REMOTE, status: "safe", reason: "remote unchanged since last sync" },
    ]);
  });

  it("flags a remote that was edited since the last sync", async () => {
    const cwd = await workspace("synced");

    const results = await checkRemoteDeletions(account, [FILE], cwd, {
      listRemote: vi.fn().mockResolvedValue(listing(["old.css"])),
      readRemoteFile: vi.fn().mockResolvedValue(Buffer.from("edited in the HubSpot UI")),
      fetchRemoteInventory: noInventory(),
    });

    expect(results[0]).toMatchObject({ status: "changed" });
  });

  it("skips the download when the inventory shows the remote has not moved", async () => {
    const syncedAt = new Date("2026-08-05T12:00:00Z");
    const cwd = await workspace("synced", syncedAt);
    const readRemoteFile = vi.fn();
    const listRemote = vi.fn();

    const results = await checkRemoteDeletions(account, [FILE], cwd, {
      listRemote,
      readRemoteFile,
      fetchRemoteInventory: vi.fn().mockResolvedValue([{ path: REMOTE, updated: syncedAt.getTime() - 60_000 }]),
    });

    expect(results[0]).toMatchObject({ status: "safe" });
    expect(listRemote).not.toHaveBeenCalled();
    expect(readRemoteFile).not.toHaveBeenCalled();
  });

  it("reports a file HubSpot no longer lists as gone", async () => {
    const cwd = await workspace("synced");
    const readRemoteFile = vi.fn();

    const results = await checkRemoteDeletions(account, [FILE], cwd, {
      listRemote: vi.fn().mockResolvedValue(listing(["other.css"])),
      readRemoteFile,
      fetchRemoteInventory: noInventory(),
    });

    expect(results[0]).toMatchObject({ status: "gone" });
    expect(readRemoteFile).not.toHaveBeenCalled();
  });

  it("never reads a missing baseline or an unreadable remote as safe", async () => {
    const deps = {
      listRemote: vi.fn().mockResolvedValue(listing(["old.css"])),
      fetchRemoteInventory: noInventory(),
    };

    const noRecord = await checkRemoteDeletions(account, [FILE], await workspace(), {
      ...deps,
      readRemoteFile: vi.fn().mockResolvedValue(Buffer.from("anything")),
    });
    const unreadable = await checkRemoteDeletions(account, [FILE], await workspace("synced"), {
      ...deps,
      readRemoteFile: vi.fn().mockResolvedValue(undefined),
    });
    const unlisted = await checkRemoteDeletions(account, [FILE], await workspace("synced"), {
      ...deps,
      listRemote: vi.fn().mockResolvedValue(undefined),
      readRemoteFile: vi.fn(),
    });

    expect(noRecord[0]).toMatchObject({ status: "unverified" });
    expect(unreadable[0]).toMatchObject({ status: "unverified" });
    expect(unlisted[0]).toMatchObject({ status: "unverified" });
  });
});
