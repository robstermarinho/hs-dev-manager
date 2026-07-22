import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  confirm: vi.fn(),
  streamHs: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  message: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  select: mocks.select,
  confirm: mocks.confirm,
  isCancel: () => false,
  note: vi.fn(),
  log: {
    warn: mocks.warn,
    error: mocks.error,
    info: mocks.info,
    message: mocks.message,
  },
}));

vi.mock("../src/hs/runner.js", () => ({ streamHs: mocks.streamHs }));

import { watchAction } from "../src/actions/watch.js";
import type { HsAccount } from "../src/hs/accounts.js";
import { localDirFor } from "../src/paths.js";
import { addPath, savePathsConfig } from "../src/state/paths-config.js";

const account: HsAccount = { name: "example", accountId: "123456", isDefault: true };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("watchAction guards", () => {
  it("returns before prompting when no paths are configured", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "hsdm-watch-"));
    await watchAction(account, cwd);
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining("No saved paths"));
    expect(mocks.streamHs).not.toHaveBeenCalled();
  });

  it("does not start watch when the local folder is missing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "hsdm-watch-"));
    await savePathsConfig(addPath({ portals: {} }, "example-123456", "/theme"), cwd);
    mocks.select.mockResolvedValue("/theme");

    await watchAction(account, cwd);

    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining("Local folder not found"));
    expect(mocks.streamHs).not.toHaveBeenCalled();
  });

  it("blocks the optional refresh when the portal has local changes", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "hsdm-watch-"));
    const localDir = localDirFor(account, "/theme", cwd);
    const file = join(localDir, "main.css");
    await mkdir(localDir, { recursive: true });
    await writeFile(file, "before", "utf8");
    await savePathsConfig(addPath({ portals: {} }, "example-123456", "/theme"), cwd);
    await execa("git", ["init", "--quiet"], { cwd });
    await execa("git", ["add", "."], { cwd });
    await execa("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base", "--quiet"], {
      cwd,
    });
    await writeFile(file, "local work", "utf8");
    mocks.select.mockResolvedValue("/theme");
    mocks.confirm.mockResolvedValue(true);

    await watchAction(account, cwd);

    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("Uncommitted changes"));
    expect(mocks.streamHs).not.toHaveBeenCalled();
  });
});
