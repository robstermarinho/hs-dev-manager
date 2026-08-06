import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prompts = vi.hoisted(() => ({
  note: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  select: vi.fn(),
  isCancel: () => false,
  note: prompts.note,
  spinner: () => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() }),
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), success: prompts.success },
}));

import { collectLintableFiles, lintFiles, reportLintResults } from "../src/actions/lint.js";

const SCOPE = "src/example-123456";

async function createWorkspace(files: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "hsdm-lint-"));
  for (const [file, content] of Object.entries(files)) {
    const absolute = join(cwd, file);
    await mkdir(join(absolute, ".."), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }
  return cwd;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("lintFiles", () => {
  it("checks lintable files and skips the rest", async () => {
    const cwd = await createWorkspace({
      [`${SCOPE}/theme/home.html`]: "{% if a %}\n",
      [`${SCOPE}/theme/fields.json`]: "[]",
      [`${SCOPE}/theme/main.css`]: "body { color: red }",
    });

    const results = await lintFiles(
      [`${SCOPE}/theme/home.html`, `${SCOPE}/theme/fields.json`, `${SCOPE}/theme/main.css`],
      cwd
    );

    expect(results.map((result) => result.file)).toEqual([`${SCOPE}/theme/home.html`, `${SCOPE}/theme/fields.json`]);
    expect(results[0]?.issues[0]?.message).toContain("never closed");
    expect(results[1]?.issues).toEqual([]);
  });

  it("ignores files that were deleted locally", async () => {
    const cwd = await createWorkspace({});
    await expect(lintFiles([`${SCOPE}/theme/gone.html`], cwd)).resolves.toEqual([]);
  });
});

describe("collectLintableFiles", () => {
  it("walks a directory recursively and returns sorted repo-relative paths", async () => {
    const cwd = await createWorkspace({
      [`${SCOPE}/theme/templates/home.html`]: "ok",
      [`${SCOPE}/theme/modules/hero.module/fields.json`]: "[]",
      [`${SCOPE}/theme/images/logo.png`]: "binary",
    });

    await expect(collectLintableFiles(join(cwd, SCOPE), cwd)).resolves.toEqual([
      `${SCOPE}/theme/modules/hero.module/fields.json`,
      `${SCOPE}/theme/templates/home.html`,
    ]);
  });

  it("returns nothing for a missing directory", async () => {
    const cwd = await createWorkspace({});
    await expect(collectLintableFiles(join(cwd, "nope"), cwd)).resolves.toEqual([]);
  });
});

describe("reportLintResults", () => {
  it("passes when there is nothing to report", () => {
    expect(reportLintResults([{ file: "a.html", issues: [] }], "Changed files")).toBe(true);
    expect(prompts.success).toHaveBeenCalledWith(expect.stringContaining("no problems"));
  });

  it("passes on warnings but fails on errors", () => {
    const warned = [{ file: "a.json", issues: [{ line: 1, column: 1, severity: "warning" as const, message: "w" }] }];
    expect(reportLintResults(warned, "Changed files")).toBe(true);

    const failed = [{ file: "a.html", issues: [{ line: 2, column: 1, severity: "error" as const, message: "e" }] }];
    expect(reportLintResults(failed, "Changed files")).toBe(false);
    expect(prompts.note).toHaveBeenCalledWith(expect.stringContaining("2:1  error  e"), expect.stringContaining("1 error(s)"));
  });
});
