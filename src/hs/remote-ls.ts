import { runHs } from "./runner.js";

export type RemoteEntryKind = "folder" | "module" | "file";

export interface RemoteEntry {
  name: string;
  kind: RemoteEntryKind;
}

/**
 * Classify a `hs cms ls` entry. The listing gives bare names only, so this is
 * a heuristic: `.module` directories are modules (fetchable units), names with
 * an extension are files, everything else is a folder.
 */
export function classifyEntry(name: string): RemoteEntryKind {
  if (name.endsWith(".module")) return "module";
  if (/\.[A-Za-z0-9]+$/.test(name)) return "file";
  return "folder";
}

/** Parse `hs cms ls` output into named, classified entries (folders first). */
export function parseLsOutput(output: string): RemoteEntry[] {
  const entries = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((name) => ({ name, kind: classifyEntry(name) }));

  const order: Record<RemoteEntryKind, number> = { folder: 0, module: 1, file: 2 };
  return entries.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
}

/** List a remote Design Manager directory. Undefined when the listing fails. */
export async function listRemote(accountId: string, path: string): Promise<RemoteEntry[] | undefined> {
  const result = await runHs(["cms", "list", path || "/"], { accountId });
  if (!result.ok) return undefined;
  return parseLsOutput(result.stdout);
}

/** Join a parent remote path and a child entry name. */
export function joinRemote(parent: string, name: string): string {
  return parent === "/" || parent === "" ? `/${name}` : `${parent}/${name}`;
}

/** Parent of a remote path ("/a/b" → "/a", "/a" → "/"). */
export function parentRemote(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "/" : path.slice(0, idx);
}
