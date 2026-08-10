import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prompts = vi.hoisted(() => ({
  select: vi.fn(),
  note: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  select: prompts.select,
  isCancel: () => false,
  note: prompts.note,
  spinner: () => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() }),
  log: { warn: prompts.warn, error: vi.fn(), info: prompts.info, success: prompts.success },
}));

import { collectLintableFiles, lintAction, lintFiles, reportLintResults } from "../src/actions/lint.js";
import type { HsAccount } from "../src/hs/accounts.js";
import { addPath, savePathsConfig } from "../src/state/paths-config.js";

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

const account: HsAccount = { name: "example", accountId: "123456", isDefault: true };

function stripAnsi(text: string): string {
  return text.replace(/\[[0-9;]*m/g, "");
}

describe("lintAction", () => {
  it("offers the saved paths alongside the changed and whole-portal choices", async () => {
    const cwd = await createWorkspace({ [`${SCOPE}/theme/home.html`]: "ok" });
    await savePathsConfig(addPath({ portals: {} }, "example-123456", "/theme"), cwd);
    prompts.select.mockResolvedValue("__back__");

    await lintAction(account, cwd);

    const options = prompts.select.mock.calls[0]![0].options as { value: string }[];
    expect(options.map((option) => option.value)).toEqual(["__changed__", "/theme", "__all__", "__back__"]);
  });

  it("lints a saved path and reports its problems", async () => {
    const cwd = await createWorkspace({
      [`${SCOPE}/theme/broken.html`]: "{% for item in items %}\n",
      [`${SCOPE}/other/ignored.html`]: "{% if a %}\n",
    });
    await savePathsConfig(addPath({ portals: {} }, "example-123456", "/theme"), cwd);
    prompts.select.mockResolvedValue("/theme");

    await lintAction(account, cwd);

    const [body, title] = prompts.note.mock.calls[0]!;
    expect(stripAnsi(body)).toContain("{% for %} is never closed");
    // The other path is not part of this run.
    expect(stripAnsi(body)).not.toContain("ignored.html");
    expect(stripAnsi(title)).toContain("/theme");
  });

  it("lints the whole portal", async () => {
    const cwd = await createWorkspace({
      [`${SCOPE}/theme/a.html`]: "{% if a %}{% endif %}",
      [`${SCOPE}/other/b.json`]: "{",
    });
    prompts.select.mockResolvedValue("__all__");

    await lintAction(account, cwd);

    expect(stripAnsi(prompts.note.mock.calls[0]![0])).toContain("Invalid JSON");
  });

  it("says so when the selection holds nothing lintable", async () => {
    const cwd = await createWorkspace({ [`${SCOPE}/theme/main.css`]: "body {}" });
    prompts.select.mockResolvedValue("__all__");

    await lintAction(account, cwd);

    expect(prompts.info).toHaveBeenCalledWith(expect.stringContaining("Nothing to lint"));
    expect(prompts.note).not.toHaveBeenCalled();
  });

  it("refuses the changed-files option outside a git repository", async () => {
    const cwd = await createWorkspace({ [`${SCOPE}/theme/a.html`]: "ok" });
    prompts.select.mockResolvedValue("__changed__");

    await lintAction(account, cwd);

    expect(prompts.warn).toHaveBeenCalledWith(expect.stringContaining("requires a git repository"));
    expect(prompts.note).not.toHaveBeenCalled();
  });

  it("does nothing when the user goes back", async () => {
    const cwd = await createWorkspace({ [`${SCOPE}/theme/a.html`]: "{% if a %}" });
    prompts.select.mockResolvedValue("__back__");

    await lintAction(account, cwd);

    expect(prompts.note).not.toHaveBeenCalled();
    expect(prompts.success).not.toHaveBeenCalled();
  });
});
