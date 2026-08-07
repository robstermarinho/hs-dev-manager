import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { initRepo, isGitRepo } from "./git.js";

/**
 * Machine-local state that should not be shared: `.hsaccount` is the portal this
 * user picked last, and `db/` records what this checkout downloaded and when.
 * `paths-config.json` is deliberately absent — it is team configuration.
 */
export const IGNORED_ENTRIES = [".hsaccount", "db/"] as const;

export const GITIGNORE_FILE = ".gitignore";
const SECTION_HEADER = "# hs-dev-manager (local state)";

/** Entries not already covered by the file, compared line by line. */
export function missingIgnoreEntries(
  gitignore: string,
  entries: readonly string[] = IGNORED_ENTRIES
): string[] {
  const present = new Set(
    gitignore
      .split("\n")
      .map((line) => line.trim().replace(/\/$/, ""))
      .filter((line) => line.length > 0 && !line.startsWith("#"))
  );
  return entries.filter((entry) => !present.has(entry.replace(/\/$/, "")));
}

/** Append the missing entries under their own header, keeping what is there. */
export function withIgnoreEntries(gitignore: string, entries: readonly string[]): string {
  if (entries.length === 0) return gitignore;
  const body = [SECTION_HEADER, ...entries].join("\n");
  if (gitignore.trim().length === 0) return `${body}\n`;
  const separator = gitignore.endsWith("\n") ? "\n" : "\n\n";
  return `${gitignore}${separator}${body}\n`;
}

export interface BootstrapResult {
  /** A repository was created here. */
  gitInitialized: boolean;
  /** Entries added to .gitignore; empty when it already covered them. */
  ignored: string[];
  /** Nothing needed doing. */
  alreadyReady: boolean;
}

export interface BootstrapOptions {
  initGit?: boolean;
  updateIgnore?: boolean;
}

/**
 * Prepare a folder for the tool: a git repository (deploy and sync commits need
 * one) and a .gitignore that keeps local state out of the team's history.
 * Safe to run again — it only ever adds what is missing.
 */
export async function bootstrapProject(
  cwd: string = process.cwd(),
  options: BootstrapOptions = {}
): Promise<BootstrapResult> {
  const { initGit = true, updateIgnore = true } = options;
  let gitInitialized = false;

  if (initGit && !(await isGitRepo(cwd))) {
    gitInitialized = await initRepo(cwd);
  }

  let ignored: string[] = [];
  if (updateIgnore) {
    const path = join(cwd, GITIGNORE_FILE);
    let current = "";
    try {
      current = await readFile(path, "utf8");
    } catch {
      // No .gitignore yet: it gets created below.
    }
    ignored = missingIgnoreEntries(current);
    if (ignored.length > 0) await writeFile(path, withIgnoreEntries(current, ignored), "utf8");
  }

  return { gitInitialized, ignored, alreadyReady: !gitInitialized && ignored.length === 0 };
}

/** One line per thing that happened, for both the menu and `hsdm init`. */
export function describeBootstrap(result: BootstrapResult): string[] {
  if (result.alreadyReady) return ["Already set up: git repository and .gitignore are in place."];
  const lines: string[] = [];
  if (result.gitInitialized) lines.push("Initialized an empty git repository.");
  if (result.ignored.length > 0) lines.push(`Added to .gitignore: ${result.ignored.join(", ")}`);
  return lines;
}
