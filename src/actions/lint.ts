import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import * as p from "@clack/prompts";
import type { HsAccount } from "../hs/accounts.js";
import { portalKey } from "../hs/accounts.js";
import { changedFiles, isGitRepo } from "../git.js";
import { countIssues, isLintable, lintContent, renderLintResults, type LintResult } from "../lint.js";
import { localDirFor, portalScope } from "../paths.js";
import { loadPathsConfig, portalPaths } from "../state/paths-config.js";
import { dim, handleCancel, menuLabel } from "../ui.js";

/** Lint the given repo-relative files, skipping deleted and non-lintable ones. */
export async function lintFiles(files: string[], cwd: string = process.cwd()): Promise<LintResult[]> {
  const results: LintResult[] = [];
  for (const file of files) {
    if (!isLintable(file)) continue;
    const absolute = join(cwd, file);
    if (!existsSync(absolute)) continue;
    try {
      results.push({ file, issues: lintContent(file, await readFile(absolute, "utf8")) });
    } catch (error) {
      results.push({
        file,
        issues: [
          {
            line: 1,
            column: 1,
            severity: "error",
            message: `Could not read the file: ${error instanceof Error ? error.message : error}`,
          },
        ],
      });
    }
  }
  return results;
}

/** Every lintable file under a local directory, as repo-relative paths. */
export async function collectLintableFiles(directory: string, cwd: string = process.cwd()): Promise<string[]> {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(cwd, join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
    .filter(isLintable)
    .sort();
}

/** Print the outcome of a lint run. Returns true when no error was found. */
export function reportLintResults(results: LintResult[], title: string): boolean {
  const errors = countIssues(results, "error");
  const warnings = countIssues(results, "warning");
  const rendered = renderLintResults(results);

  if (errors === 0 && warnings === 0) {
    p.log.success(`${title}: no problems in ${results.length} file(s)`);
    return true;
  }

  p.note(rendered, `${title} · ${errors} error(s), ${warnings} warning(s)`);
  return errors === 0;
}

/** Menu action: lint local HubL templates and JSON assets for this portal. */
export async function lintAction(account: HsAccount, cwd: string = process.cwd()): Promise<void> {
  const CHANGED = "__changed__";
  const ALL = "__all__";
  const BACK = "__back__";

  const config = await loadPathsConfig(cwd);
  const paths = portalPaths(config, portalKey(account));

  const choice = handleCancel(
    await p.select({
      message: "What do you want to lint?",
      options: [
        { value: CHANGED, label: menuLabel("list", "Changed files"), hint: "uncommitted files in this portal" },
        ...paths.map((path) => ({ value: path, label: menuLabel("path", path) })),
        { value: ALL, label: menuLabel("all", "Everything in this portal") },
        { value: BACK, label: menuLabel("back", "Back") },
      ],
    })
  );
  if (choice === BACK) return;

  let files: string[];
  let title: string;

  if (choice === CHANGED) {
    if (!(await isGitRepo(cwd))) {
      p.log.warn("Linting changed files requires a git repository.");
      return;
    }
    files = await changedFiles(cwd, portalScope(account));
    title = "Changed files";
  } else if (choice === ALL) {
    files = await collectLintableFiles(join(cwd, portalScope(account)), cwd);
    title = `All files · ${account.name}`;
  } else {
    files = await collectLintableFiles(localDirFor(account, choice, cwd), cwd);
    title = choice;
  }

  const spinner = p.spinner();
  spinner.start(`Linting ${files.length} file(s)`);
  const results = await lintFiles(files, cwd);
  spinner.stop(`Linted ${results.length} file(s)`);

  if (results.length === 0) {
    p.log.info(dim("Nothing to lint here (only .html/.hubl/.json files are checked)."));
    return;
  }
  reportLintResults(results, title);
}
