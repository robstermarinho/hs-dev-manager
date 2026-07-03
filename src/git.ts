import { execa } from "execa";

async function git(args: string[], cwd: string): Promise<{ ok: boolean; stdout: string }> {
  const result = await execa("git", args, { cwd, reject: false });
  return { ok: result.exitCode === 0, stdout: result.stdout ?? "" };
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const result = await git(["rev-parse", "--is-inside-work-tree"], cwd);
  return result.ok && result.stdout.trim() === "true";
}

/**
 * Changed files (modified, staged, untracked) limited to `scope` (repo-relative path).
 * Parses `git status --porcelain -- <scope>`.
 */
export async function changedFiles(cwd: string, scope?: string): Promise<string[]> {
  const args = ["status", "--porcelain"];
  if (scope) args.push("--", scope);
  const result = await git(args, cwd);
  if (!result.ok) return [];
  return result.stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const path = line.slice(3);
      // Renames appear as "old -> new"; keep the new path.
      const arrow = path.indexOf(" -> ");
      return (arrow >= 0 ? path.slice(arrow + 4) : path).replace(/^"|"$/g, "");
    });
}

/** Stage and commit only files under `scope`. Returns false if nothing to commit or on failure. */
export async function commitScoped(cwd: string, scope: string, message: string): Promise<boolean> {
  const add = await git(["add", "--", scope], cwd);
  if (!add.ok) return false;
  const staged = await git(["diff", "--cached", "--quiet", "--", scope], cwd);
  if (staged.ok) return false; // exit 0 = no staged changes in scope
  const commit = await git(["commit", "-m", message, "--", scope], cwd);
  return commit.ok;
}
