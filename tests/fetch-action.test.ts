import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execa } from "execa";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prompts = vi.hoisted(() => ({
  select: vi.fn(),
  text: vi.fn(),
  confirm: vi.fn(),
  note: vi.fn(),
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
  note: prompts.note,
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

/** Stand-in for a successful download: overwrites one tracked file and adds a new one. */
function downloadFrom(file: string) {
  return async (): Promise<boolean> => {
    await writeFile(file, "from hubspot", "utf8");
    await writeFile(join(dirname(file), "new.css"), "new from hubspot", "utf8");
    return true;
  };
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

  it("commits the sync when the user reviews and confirms", async () => {
    const { cwd, file } = await createRepo();
    prompts.select.mockResolvedValueOnce("/theme").mockResolvedValueOnce("commit");

    await fetchAction(account, cwd, downloadFrom(file));

    expect(await changedFiles(cwd, "src/example-123456")).toEqual([]);
    expect((await execa("git", ["rev-list", "--count", "HEAD"], { cwd })).stdout).toBe("2");
    expect(prompts.success).toHaveBeenCalledWith(expect.stringContaining("Sync commit created"));
  });

  it("shows the diff and stays on the review prompt", async () => {
    const { cwd, file } = await createRepo();
    prompts.select.mockResolvedValueOnce("/theme").mockResolvedValueOnce("diff").mockResolvedValueOnce("commit");

    await fetchAction(account, cwd, downloadFrom(file));

    const diffNote = prompts.note.mock.calls.find(([, title]) => String(title).includes("hubspot → local"));
    expect(diffNote?.[0]).toContain("-before");
    expect(diffNote?.[0]).toContain("+from hubspot");
    expect((await execa("git", ["rev-list", "--count", "HEAD"], { cwd })).stdout).toBe("2");
  });

  it("undoes the fetch, restoring tracked files and deleting new ones", async () => {
    const { cwd, file } = await createRepo();
    prompts.select.mockResolvedValueOnce("/theme").mockResolvedValueOnce("revert");

    await fetchAction(account, cwd, downloadFrom(file));

    expect(await readFile(file, "utf8")).toBe("before");
    expect(existsSync(join(cwd, "src/example-123456/theme/new.css"))).toBe(false);
    expect(await changedFiles(cwd, "src/example-123456")).toEqual([]);
    expect((await execa("git", ["rev-list", "--count", "HEAD"], { cwd })).stdout).toBe("1");
  });

  it("keeps the changes in the working tree without staging them", async () => {
    const { cwd, file } = await createRepo();
    prompts.select.mockResolvedValueOnce("/theme").mockResolvedValueOnce("keep");

    await fetchAction(account, cwd, downloadFrom(file));

    expect(await readFile(file, "utf8")).toBe("from hubspot");
    expect((await execa("git", ["rev-list", "--count", "HEAD"], { cwd })).stdout).toBe("1");
    // "Leave uncommitted" must not leave the intent-to-add entries behind.
    expect((await execa("git", ["diff", "--cached", "--name-only"], { cwd })).stdout).toBe("");
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
    // The guard runs before the path picker, so the user is never prompted.
    expect(prompts.select).not.toHaveBeenCalled();
    expect(prompts.text).not.toHaveBeenCalled();
  });
});
