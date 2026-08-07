import { execa } from "execa";

interface GitResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
}

async function git(args: string[], cwd: string): Promise<GitResult> {
  const result = await execa("git", args, { cwd, reject: false });
  return {
    ok: result.exitCode === 0,
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout ?? "",
  };
}

/** Create an empty repository. False when git refuses (already one, no permission). */
export async function initRepo(cwd: string): Promise<boolean> {
  const result = await git(["init", "--quiet"], cwd);
  return result.ok;
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const result = await git(["rev-parse", "--is-inside-work-tree"], cwd);
  return result.ok && result.stdout.trim() === "true";
}

/** Parse NUL-delimited porcelain v1 output without Git's path quoting. */
export function parsePorcelainZ(output: string): string[] {
  const records = output.split("\0");
  const files: string[] = [];

  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record || record.length < 4) continue;

    const status = record.slice(0, 2);
    files.push(record.slice(3));

    // With -z, rename/copy records are: "XY destination\0source\0".
    if (status.includes("R") || status.includes("C")) index++;
  }

  return files;
}

/** Changed files (modified, staged, untracked) limited to a repo-relative scope. */
export async function changedFiles(cwd: string, scope?: string): Promise<string[]> {
  const args = ["status", "--porcelain=v1", "-z", "--untracked-files=all"];
  if (scope) args.push("--", scope);
  const result = await git(args, cwd);
  if (!result.ok) return [];
  return parsePorcelainZ(result.stdout);
}

/**
 * Register untracked files in the index without their content, so files that a
 * fetch just created show up in `git diff` instead of being invisible.
 */
export async function markIntentToAdd(cwd: string, scope: string): Promise<boolean> {
  const result = await git(["add", "--intent-to-add", "--", scope], cwd);
  return result.ok;
}

/** Drop staged entries in a scope, leaving the working tree untouched. */
export async function unstageScope(cwd: string, scope: string): Promise<boolean> {
  const result = await git(["reset", "--quiet", "--", scope], cwd);
  return result.ok;
}

/** Working-tree diff against HEAD, limited to a scope. Empty string on failure. */
export async function diffScope(cwd: string, scope: string, mode: "full" | "stat" = "full"): Promise<string> {
  const args = ["diff", "--no-color"];
  if (mode === "stat") args.push("--stat");
  args.push("--", scope);
  const result = await git(args, cwd);
  return result.ok ? result.stdout : "";
}

/**
 * Undo every change in a scope: unstage, restore tracked files from HEAD and
 * delete files that are not in HEAD. Destructive — only safe when the scope was
 * clean before the change being undone. Verified by re-reading git status.
 */
export async function restoreScope(cwd: string, scope: string): Promise<boolean> {
  await git(["reset", "--quiet", "--", scope], cwd);
  await git(["checkout", "--", scope], cwd);
  await git(["clean", "-fdq", "--", scope], cwd);
  return (await changedFiles(cwd, scope)).length === 0;
}

/**
 * Stage and commit only the given pathspec(s) — a scope directory or a list of
 * files. Returns false if nothing to commit or on failure.
 */
export async function commitScoped(cwd: string, scope: string | string[], message: string): Promise<boolean> {
  const paths = Array.isArray(scope) ? scope : [scope];
  if (paths.length === 0) return false;
  const add = await git(["add", "--", ...paths], cwd);
  if (!add.ok) return false;
  const staged = await git(["diff", "--cached", "--quiet", "--", ...paths], cwd);
  if (staged.exitCode === 0) return false; // no staged changes in scope
  if (staged.exitCode !== 1) return false; // git diff itself failed
  const commit = await git(["commit", "-m", message, "--", ...paths], cwd);
  return commit.ok;
}
