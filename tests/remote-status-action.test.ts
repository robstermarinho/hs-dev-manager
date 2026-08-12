import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as InventoryModule from "../src/hs/remote-inventory.js";

const mocks = vi.hoisted(() => ({ fetchRemoteInventory: vi.fn() }));

vi.mock("../src/hs/remote-inventory.js", async (importOriginal) => {
  const actual = await importOriginal<typeof InventoryModule>();
  return { ...actual, fetchRemoteInventory: mocks.fetchRemoteInventory };
});

import { computeRemoteStatus } from "../src/actions/remote-status.js";
import type { HsAccount } from "../src/hs/accounts.js";
import { addPath, savePathsConfig } from "../src/state/paths-config.js";
import { describeQuietStatus } from "../src/remote-status.js";
import { recordRemoteFiles, saveRemoteState, sha256 } from "../src/state/remote-state.js";

const account: HsAccount = { name: "example", accountId: "123456", isDefault: true };
const SYNCED = new Date("2026-08-05T12:00:00.000Z");

interface WorkspaceOptions {
  paths?: string[];
  /** Files created under src/example-123456/, as remote paths. */
  localFiles?: string[];
  /** Remote paths recorded as synced at SYNCED. */
  synced?: string[];
}

async function workspace(options: WorkspaceOptions = {}): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "hsdm-compute-status-"));

  const paths = options.paths ?? ["/theme"];
  if (paths.length > 0) {
    let config = { portals: {} };
    for (const path of paths) config = addPath(config, "example-123456", path);
    await savePathsConfig(config, cwd);
  }

  for (const remotePath of options.localFiles ?? []) {
    const absolute = join(cwd, "src", "example-123456", remotePath.replace(/^\//, ""));
    await mkdir(join(absolute, ".."), { recursive: true });
    await writeFile(absolute, "local", "utf8");
  }

  if (options.synced?.length) {
    await saveRemoteState(
      recordRemoteFiles(
        { files: {} },
        "example-123456",
        // The real hash of the local content: a record that does not match what
        // is on disk means the local copy diverged from the sync.
        options.synced.map((remotePath) => ({ remotePath, sha256: sha256("local") })),
        SYNCED
      ),
      cwd
    );
  }
  return cwd;
}

function remoteItem(path: string, updated: number, kind: "file" | "module" = "file") {
  return { path, updated, kind };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("computeRemoteStatus", () => {
  it("reports assets edited on HubSpot after the last sync", async () => {
    const cwd = await workspace({ localFiles: ["/theme/main.css"], synced: ["/theme/main.css"] });
    mocks.fetchRemoteInventory.mockResolvedValue([
      remoteItem("/theme/main.css", SYNCED.getTime() + 3_600_000),
    ]);

    const status = await computeRemoteStatus(account, cwd);

    expect(status?.changed.map((item) => item.path)).toEqual(["/theme/main.css"]);
    expect(status?.added).toEqual([]);
    expect(mocks.fetchRemoteInventory).toHaveBeenCalledWith("123456");
  });

  it("reports assets that exist on HubSpot but not locally", async () => {
    const cwd = await workspace({ localFiles: ["/theme/main.css"], synced: ["/theme/main.css"] });
    mocks.fetchRemoteInventory.mockResolvedValue([
      remoteItem("/theme/main.css", SYNCED.getTime()),
      remoteItem("/theme/modules/hero.module", SYNCED.getTime() + 3_600_000, "module"),
    ]);

    const status = await computeRemoteStatus(account, cwd);

    expect(status?.added.map((item) => item.path)).toEqual(["/theme/modules/hero.module"]);
    expect(status?.changed).toEqual([]);
  });

  it("is empty when nothing moved since the last sync", async () => {
    const cwd = await workspace({ localFiles: ["/theme/main.css"], synced: ["/theme/main.css"] });
    mocks.fetchRemoteInventory.mockResolvedValue([remoteItem("/theme/main.css", SYNCED.getTime())]);

    await expect(computeRemoteStatus(account, cwd)).resolves.toEqual({
      changed: [],
      added: [],
      baselines: new Map([["/theme", "recorded"]]),
    });
  });

  it("ignores assets outside the portal's saved paths", async () => {
    const cwd = await workspace({
      paths: ["/theme"],
      localFiles: ["/theme/main.css"],
      synced: ["/theme/main.css", "/other/site.css"],
    });
    mocks.fetchRemoteInventory.mockResolvedValue([
      remoteItem("/theme/main.css", SYNCED.getTime()),
      remoteItem("/other/site.css", SYNCED.getTime() + 3_600_000),
    ]);

    await expect(computeRemoteStatus(account, cwd)).resolves.toEqual({
      changed: [],
      added: [],
      baselines: new Map([["/theme", "recorded"]]),
    });
  });

  it("does not call HubSpot when the portal has no saved paths", async () => {
    const cwd = await workspace({ paths: [] });

    await expect(computeRemoteStatus(account, cwd)).resolves.toEqual({
      changed: [],
      added: [],
      baselines: new Map(),
    });
    expect(mocks.fetchRemoteInventory).not.toHaveBeenCalled();
  });

  it("reports a path whose local files no longer match the recorded sync", async () => {
    // A git revert or a hand edit outside the tool leaves the recorded sync time
    // describing content that is gone, so nothing can be compared against it.
    const cwd = await workspace({ localFiles: ["/theme/main.css"], synced: ["/theme/main.css"] });
    await writeFile(join(cwd, "src", "example-123456", "theme", "main.css"), "reverted", "utf8");
    mocks.fetchRemoteInventory.mockResolvedValue([remoteItem("/theme/main.css", SYNCED.getTime())]);

    const status = await computeRemoteStatus(account, cwd);

    expect(status?.baselines.get("/theme")).toBe("diverged");
    expect(describeQuietStatus(status!).ok).toBe(false);
  });

  it("ignores JSON key-order rewrites when judging divergence", async () => {
    const cwd = await workspace({ localFiles: ["/theme/fields.json"], synced: ["/theme/fields.json"] });
    await writeFile(join(cwd, "src", "example-123456", "theme", "fields.json"), "reordered", "utf8");
    mocks.fetchRemoteInventory.mockResolvedValue([remoteItem("/theme/fields.json", SYNCED.getTime())]);

    const status = await computeRemoteStatus(account, cwd);

    expect(status?.baselines.get("/theme")).toBe("recorded");
  });

  it("is undefined when the inventory cannot be read", async () => {
    // Undefined, never an empty status: callers must not read a failed listing
    // as "your copy is current".
    const cwd = await workspace({ localFiles: ["/theme/main.css"], synced: ["/theme/main.css"] });
    mocks.fetchRemoteInventory.mockResolvedValue(undefined);

    await expect(computeRemoteStatus(account, cwd)).resolves.toBeUndefined();
  });

  it("is undefined when the listing throws", async () => {
    const cwd = await workspace({ localFiles: ["/theme/main.css"], synced: ["/theme/main.css"] });
    mocks.fetchRemoteInventory.mockRejectedValue(new Error("network is down"));

    await expect(computeRemoteStatus(account, cwd)).resolves.toBeUndefined();
  });

  it("treats an asset it cannot map to a local path as missing locally", async () => {
    // A portal name that cannot become a directory makes localDirFor throw.
    const unsafe: HsAccount = { name: "../escape", accountId: "123456", isDefault: true };
    const cwd = await mkdtemp(join(tmpdir(), "hsdm-compute-status-"));
    await savePathsConfig(addPath({ portals: {} }, "../escape-123456", "/theme"), cwd);
    mocks.fetchRemoteInventory.mockResolvedValue([remoteItem("/theme/main.css", SYNCED.getTime())]);

    const status = await computeRemoteStatus(unsafe, cwd);

    expect(status?.added.map((item) => item.path)).toEqual(["/theme/main.css"]);
  });
});
