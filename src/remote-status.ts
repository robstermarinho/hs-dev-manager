import type { RemoteItem } from "./hs/remote-inventory.js";

/**
 * Compares remote modification times against the last time this tool synced each
 * asset. Timestamps come from two different clocks (HubSpot's server and this
 * machine), so a tolerance keeps our own uploads from looking like remote edits.
 */
export const CLOCK_TOLERANCE_MS = 60_000;

/** Escape hatch for CI, scripted runs, and access keys without the CMS scopes. */
export const REMOTE_CHECK_ENV = "HSDM_NO_REMOTE_CHECK";

/** True for "1", "true", "yes" (any case); the check runs otherwise. */
export function isRemoteCheckDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[REMOTE_CHECK_ENV];
  return value ? ["1", "true", "yes"].includes(value.trim().toLowerCase()) : false;
}

export interface RemoteStatusInput {
  items: RemoteItem[];
  /** Saved remote paths of the portal; anything outside them is ignored. */
  paths: string[];
  /** Last sync time (epoch ms) recorded for a remote path, if any. */
  syncedAt: (remotePath: string) => number | undefined;
  /** Whether the remote path has a local counterpart on disk. */
  existsLocally: (remotePath: string) => boolean;
  toleranceMs?: number;
}

export interface RemoteStatus {
  /** Assets modified on HubSpot after our last sync. */
  changed: RemoteItem[];
  /** Assets that exist on HubSpot but not locally. */
  added: RemoteItem[];
}

export function isUnder(remotePath: string, savedPath: string): boolean {
  return remotePath === savedPath || remotePath.startsWith(`${savedPath}/`);
}

export function compareRemote(input: RemoteStatusInput): RemoteStatus {
  const tolerance = input.toleranceMs ?? CLOCK_TOLERANCE_MS;
  const changed: RemoteItem[] = [];
  const added: RemoteItem[] = [];

  for (const item of input.items) {
    if (!input.paths.some((saved) => isUnder(item.path, saved))) continue;

    if (!input.existsLocally(item.path)) {
      added.push(item);
      continue;
    }

    // No sync record means we have nothing to compare against — stay quiet
    // rather than flagging every file the first time.
    const synced = input.syncedAt(item.path);
    if (synced === undefined) continue;

    if (item.updated > synced + tolerance) changed.push(item);
  }

  return { changed, added };
}

export interface PathDrift {
  changed: number;
  added: number;
}

/** How much drift sits under each saved path, for per-path hints. */
export function driftByPath(status: RemoteStatus, paths: string[]): Map<string, PathDrift> {
  const byPath = new Map<string, PathDrift>(paths.map((path) => [path, { changed: 0, added: 0 }]));
  for (const [key, items] of [
    ["changed", status.changed],
    ["added", status.added],
  ] as const) {
    for (const item of items) {
      const owner = paths.find((path) => isUnder(item.path, path));
      if (!owner) continue;
      const drift = byPath.get(owner);
      if (drift) drift[key]++;
    }
  }
  return byPath;
}

/** Hint for one saved path: "2 changed · 1 new", or undefined when it is in sync. */
export function describePathDrift(drift: PathDrift | undefined): string | undefined {
  if (!drift) return undefined;
  const parts: string[] = [];
  if (drift.changed > 0) parts.push(`${drift.changed} changed`);
  if (drift.added > 0) parts.push(`${drift.added} new`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** One line per drifted asset, newest first, capped so the note stays readable. */
export function driftLines(status: RemoteStatus, limit = 12): string[] {
  const entries = [
    ...status.changed.map((item) => ({ label: "changed", item })),
    ...status.added.map((item) => ({ label: "new", item })),
  ].sort((a, b) => b.item.updated - a.item.updated);

  const lines = entries
    .slice(0, limit)
    .map(({ label, item }) => `  ${label.padEnd(7)} ${item.path.replace(/^\//, "")}`);

  const hidden = entries.length - lines.length;
  if (hidden > 0) lines.push(`  … and ${hidden} more`);
  return lines;
}

/** Remote path → server modification time, for lookups during a deploy check. */
export function inventoryIndex(items: RemoteItem[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const item of items) {
    index.set(item.path, Math.max(index.get(item.path) ?? 0, item.updated));
  }
  return index;
}

/**
 * Modification time covering a remote file. Files inside a module have no
 * listing of their own — the module is one object — so the enclosing `.module`
 * entry answers for them.
 */
export function inventoryUpdatedFor(index: Map<string, number>, remotePath: string): number | undefined {
  const exact = index.get(remotePath);
  if (exact !== undefined) return exact;

  const segments = remotePath.split("/");
  for (let end = segments.length - 1; end > 1; end--) {
    const ancestor = segments.slice(0, end).join("/");
    if (!ancestor.endsWith(".module")) continue;
    return index.get(ancestor);
  }
  return undefined;
}

/**
 * Whether a remote asset can be trusted as untouched since our last sync, which
 * makes downloading it to compare contents unnecessary.
 */
export function isUnchangedSince(
  updated: number,
  syncedAtMs: number | undefined,
  toleranceMs: number = CLOCK_TOLERANCE_MS
): boolean {
  if (syncedAtMs === undefined) return false;
  return updated <= syncedAtMs + toleranceMs;
}

/** Badge text for the fetch menu entry; undefined when nothing is out of date. */
export function describeRemoteStatus(status: RemoteStatus): string | undefined {
  const parts: string[] = [];
  if (status.changed.length > 0) {
    parts.push(`${status.changed.length} changed on HubSpot`);
  }
  if (status.added.length > 0) {
    parts.push(`${status.added.length} new`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
