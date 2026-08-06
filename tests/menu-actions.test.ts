import { access, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prompts = vi.hoisted(() => ({
  select: vi.fn(),
  confirm: vi.fn(),
  note: vi.fn(),
  warn: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  select: prompts.select,
  confirm: prompts.confirm,
  isCancel: () => false,
  note: prompts.note,
  log: {
    warn: prompts.warn,
    success: prompts.success,
    error: prompts.error,
  },
}));

import { helperAction } from "../src/actions/helper.js";
import { historyAction } from "../src/actions/history.js";
import { removePathAction } from "../src/actions/remove-path.js";
import type { HsAccount } from "../src/hs/accounts.js";
import { localDirFor } from "../src/paths.js";
import { addDeploy, saveHistory, timestampNow } from "../src/state/history.js";
import { addPath, loadPathsConfig, portalPaths, savePathsConfig } from "../src/state/paths-config.js";

const account: HsAccount = { name: "example", accountId: "123456", isDefault: true };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("removePathAction", () => {
  it("unregisters a path without deleting local files by default", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "hsdm-remove-"));
    const localDir = localDirFor(account, "/theme", cwd);
    await mkdir(localDir, { recursive: true });
    await savePathsConfig(addPath({ portals: {} }, "example-123456", "/theme"), cwd);
    prompts.select.mockResolvedValue("/theme");
    prompts.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await removePathAction(account, cwd);

    expect(portalPaths(await loadPathsConfig(cwd), "example-123456")).toEqual([]);
    await expect(access(localDir)).resolves.toBeUndefined();
  });

  it("deletes the local folder only after a second confirmation", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "hsdm-remove-"));
    const localDir = localDirFor(account, "/theme", cwd);
    await mkdir(localDir, { recursive: true });
    await savePathsConfig(addPath({ portals: {} }, "example-123456", "/theme"), cwd);
    prompts.select.mockResolvedValue("/theme");
    prompts.confirm.mockResolvedValue(true);

    await removePathAction(account, cwd);

    await expect(access(localDir)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("read-only menu actions", () => {
  it("renders filtered deploy history", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "hsdm-history-"));
    await saveHistory(
      addDeploy(
        { deploys: [] },
        {
          timestamp: timestampNow(new Date("2026-07-21T10:00:00")),
          portal: "example",
          portal_id: "123456",
          message: "deploy theme",
          status: "success",
          file_count: 1,
          files: ["theme/main.css"],
        }
      ),
      cwd
    );

    prompts.select.mockResolvedValueOnce("0").mockResolvedValueOnce("__back__");

    await historyAction(account, cwd);

    expect(prompts.note).toHaveBeenCalledWith(
      expect.stringContaining("deploy theme"),
      expect.stringContaining("2026-07-21")
    );
  });

  it("renders the built-in help", async () => {
    await helperAction();
    expect(prompts.note).toHaveBeenCalledWith(expect.stringContaining("Quick start"), "Help");
  });
});
