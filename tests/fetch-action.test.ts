import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prompts = vi.hoisted(() => ({
  select: vi.fn(),
  text: vi.fn(),
  confirm: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  message: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  select: prompts.select,
  text: prompts.text,
  confirm: prompts.confirm,
  isCancel: () => false,
  log: {
    warn: prompts.warn,
    error: prompts.error,
    info: prompts.info,
    success: prompts.success,
    message: prompts.message,
  },
}));

import { configurePathAction, fetchAction } from "../src/actions/fetch.js";
import type { HsAccount } from "../src/hs/accounts.js";
import { changedFiles } from "../src/git.js";
import { addPath, savePathsConfig } from "../src/state/paths-config.js";

const account: HsAccount = { name: "example", accountId: "123456", isDefault: true };

async function createRepo(): Promise<{ cwd: string; file: string }> {
  const cwd = await mkdtemp(join(tmpdir(), "hsdm-fetch-"));
  const file = join(cwd, "src", "example-123456", "theme", "main.css");
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, "before", "utf8");
  await execa("git", ["init", "--quiet"], { cwd });
  await execa("git", ["add", "."], { cwd });
  await execa("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base", "--quiet"], {
    cwd,
  });
  await savePathsConfig(addPath({ portals: {} }, "example-123456", "/theme"), cwd);
  return { cwd, file };
}

beforeEach(() => {
  vi.clearAllMocks();
  prompts.confirm.mockResolvedValue(true);
});

describe("fetchAction", () => {
  it("leaves partial results uncommitted when a fetch fails", async () => {
    const { cwd, file } = await createRepo();
    prompts.select.mockResolvedValue("/theme");

    await fetchAction(account, cwd, async () => {
      await writeFile(file, "partial", "utf8");
      return false;
    });

    expect(await changedFiles(cwd, "src/example-123456")).toEqual([
      "src/example-123456/theme/main.css",
    ]);
    expect((await execa("git", ["rev-list", "--count", "HEAD"], { cwd })).stdout).toBe("1");
    expect(prompts.warn).toHaveBeenCalledWith(expect.stringContaining("left uncommitted"));
  });
});

describe("configurePathAction", () => {
  it("does not overwrite or commit when the portal scope is dirty", async () => {
    const { cwd, file } = await createRepo();
    await writeFile(file, "local work", "utf8");
    prompts.select.mockResolvedValue("type");
    prompts.text.mockResolvedValue("/theme");
    const fetcher = vi.fn().mockResolvedValue(true);

    await configurePathAction(account, cwd, fetcher);

    expect(fetcher).not.toHaveBeenCalled();
    expect(prompts.error).toHaveBeenCalledWith(expect.stringContaining("Uncommitted changes"));
  });
});
