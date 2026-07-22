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
