import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  multiselect: vi.fn(),
  text: vi.fn(),
  confirm: vi.fn(),
  upload: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  note: vi.fn(),
  spinnerStart: vi.fn(),
  spinnerStop: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  multiselect: mocks.multiselect,
  text: mocks.text,
  confirm: mocks.confirm,
  isCancel: () => false,
  note: mocks.note,
  spinner: () => ({ start: mocks.spinnerStart, stop: mocks.spinnerStop }),
  log: {
    warn: mocks.warn,
    error: mocks.error,
    info: mocks.info,
    success: mocks.success,
  },
}));

vi.mock("../src/hs/runner.js", () => ({ runHs: mocks.upload }));

import { deployAction } from "../src/actions/deploy.js";
import type { HsAccount } from "../src/hs/accounts.js";
import { loadHistory } from "../src/state/history.js";

const account: HsAccount = { name: "example", accountId: "123456", isDefault: true };

async function createRepo(): Promise<{ cwd: string; first: string; second: string }> {
  const cwd = await mkdtemp(join(tmpdir(), "hsdm-deploy-"));
  const root = join(cwd, "src", "example-123456", "theme");
  const first = join(root, "first.css");
  const second = join(root, "second.css");
  await mkdir(root, { recursive: true });
  await writeFile(first, "before", "utf8");
  await writeFile(second, "before", "utf8");
  await execa("git", ["init", "--quiet"], { cwd });
  await execa("git", ["add", "."], { cwd });
  await execa("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base", "--quiet"], {
    cwd,
  });
  await writeFile(first, "uploaded", "utf8");
  await writeFile(second, "failed", "utf8");
  return { cwd, first, second };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.text.mockResolvedValue("feat(hubspot): deploy selected files");
  mocks.confirm.mockResolvedValue(true);
});

describe("deployAction", () => {
  it("commits only successful uploads and records a partial deploy", async () => {
    const { cwd, first, second } = await createRepo();
    const selected = [
      "src/example-123456/theme/first.css",
      "src/example-123456/theme/second.css",
    ];
    mocks.multiselect.mockResolvedValue(selected);
    mocks.upload
      .mockResolvedValueOnce({ ok: true, exitCode: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ ok: false, exitCode: 1, stdout: "", stderr: "upload failed" });

    await deployAction(account, cwd);

    expect(mocks.upload).toHaveBeenNthCalledWith(
      1,
      ["cms", "upload", first, "/theme/first.css"],
      { accountId: "123456", cwd }
    );
    expect(mocks.upload).toHaveBeenNthCalledWith(
      2,
      ["cms", "upload", second, "/theme/second.css"],
      { accountId: "123456", cwd }
    );
    expect((await execa("git", ["show", "HEAD:src/example-123456/theme/first.css"], { cwd })).stdout).toBe(
      "uploaded"
    );
    expect((await readFile(second, "utf8"))).toBe("failed");
    expect((await execa("git", ["status", "--short"], { cwd })).stdout).toContain("second.css");

    const history = await loadHistory(cwd);
    expect(history.deploys[0]).toMatchObject({ status: "partial", file_count: 1, files: [selected[0]] });
  });
});
