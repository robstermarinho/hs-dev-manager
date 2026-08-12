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

/**
 * Where the "we were in sync at this time" baseline of a saved path came from.
 *
 * - `recorded`: this tool synced the assets and wrote `db/remote-state.json`.
 * - `inferred`: no record, so local file times stand in for it — good enough for
 *   repos migrated from the bash version, but it dates the local *write*, not a
 *   verified match with HubSpot.
 * - `diverged`: there is a record, but the local files no longer match it, so
 *   the recorded time no longer describes the working copy.
 * - `missing`: neither. Nothing can be said about the path, and saying nothing
 *   must never be rendered as "in sync".
 */
export type BaselineKind = "recorded" | "inferred" | "diverged" | "missing";

const BASELINE_RANK: Record<BaselineKind, number> = {
  recorded: 0,
  inferred: 1,
  diverged: 2,
  missing: 3,
};

export interface RemoteStatusInput {
  items: RemoteItem[];
  /** Saved remote paths of the portal; anything outside them is ignored. */
  paths: string[];
  /** Last sync time (epoch ms) recorded for a remote path, if any. */
  syncedAt: (remotePath: string) => number | undefined;
  /** Fallback baseline: newest local write time under a remote path, if readable. */
  localModifiedAt?: (remotePath: string) => number | undefined;
  /** Whether the remote path has a local counterpart on disk. */
  existsLocally: (remotePath: string) => boolean;
  toleranceMs?: number;
}

export interface RemoteStatus {
  /** Assets modified on HubSpot after our last sync. */
  changed: RemoteItem[];
  /** Assets that exist on HubSpot but not locally. */
  added: RemoteItem[];
  /** Baseline quality per saved path — the weakest one found under it. */
  baselines: Map<string, BaselineKind>;
}

export function isUnder(remotePath: string, savedPath: string): boolean {
  return remotePath === savedPath || remotePath.startsWith(`${savedPath}/`);
}

export function compareRemote(input: RemoteStatusInput): RemoteStatus {
  const tolerance = input.toleranceMs ?? CLOCK_TOLERANCE_MS;
  const changed: RemoteItem[] = [];
  const added: RemoteItem[] = [];
  // A saved path with nothing comparable under it has no baseline either: an
  // empty comparison is not evidence of being up to date. Items then lower the
  // verdict from `recorded` as needed — the weakest one under a path wins.
  const baselines = new Map<string, BaselineKind>(input.paths.map((path) => [path, "missing"]));
  const compared = new Set<string>();

  const rateBaseline = (remotePath: string, kind: BaselineKind): void => {
    const owner = input.paths.find((path) => isUnder(remotePath, path));
    if (owner === undefined) return;
    const current = compared.has(owner) ? baselines.get(owner) : undefined;
    compared.add(owner);
    if (current === undefined || BASELINE_RANK[kind] > BASELINE_RANK[current]) baselines.set(owner, kind);
  };

  for (const item of input.items) {
    if (!input.paths.some((saved) => isUnder(item.path, saved))) continue;

    if (!input.existsLocally(item.path)) {
      added.push(item);
      continue;
    }

    // No sync record: fall back to when the local copy was written. Without even
    // that, the asset stays uncomparable and the path is reported as such —
    // never as "in sync", which is what made real remote edits invisible.
    const recorded = input.syncedAt(item.path);
    const baseline = recorded ?? input.localModifiedAt?.(item.path);
    if (baseline === undefined) {
      rateBaseline(item.path, "missing");
      continue;
    }
    rateBaseline(item.path, recorded === undefined ? "inferred" : "recorded");

    if (item.updated > baseline + tolerance) changed.push(item);
  }

  return { changed, added, baselines };
}

/**
 * The drift sets alone. Most consumers only summarize what moved and do not care
 * where the baseline came from.
 */
export type RemoteDriftSets = Pick<RemoteStatus, "changed" | "added">;

/**
 * Downgrade the paths whose local files no longer match the sync they were
 * recorded at — a git checkout, a revert or a hand edit outside the tool. Their
 * recorded timestamp still says "synced", but it no longer describes what is on
 * disk, so no comparison against it can be trusted.
 */
export function applyDivergence(status: RemoteStatus, divergedPaths: Iterable<string>): RemoteStatus {
  const baselines = new Map(status.baselines);
  for (const path of divergedPaths) {
    const current = baselines.get(path);
    if (current === undefined || BASELINE_RANK.diverged > BASELINE_RANK[current]) {
      baselines.set(path, "diverged");
    }
  }
  return { ...status, baselines };
}

/** Saved paths whose local copy drifted away from the recorded sync. */
export function divergedPaths(status: RemoteStatus): string[] {
  return [...status.baselines].filter(([, kind]) => kind === "diverged").map(([path]) => path);
}

/** Saved paths whose freshness the check could not establish at all. */
export function unverifiedPaths(status: RemoteStatus): string[] {
  return [...status.baselines].filter(([, kind]) => kind === "missing").map(([path]) => path);
}

/** Saved paths compared against local file times rather than a recorded sync. */
export function inferredPaths(status: RemoteStatus): string[] {
  return [...status.baselines].filter(([, kind]) => kind === "inferred").map(([path]) => path);
}

/**
 * Headline for a check that found no drift. Never a bare "matches your local
 * copy" when part of the portal could not be compared — that phrasing turned
 * "no answer" into a false all-clear.
 */
export function describeQuietStatus(status: RemoteStatus): { message: string; ok: boolean } {
  const diverged = divergedPaths(status);
  if (diverged.length > 0) {
    return {
      message: `Local copy of ${diverged.join(", ")} no longer matches its last sync — cannot compare with HubSpot`,
      ok: false,
    };
  }
  const unverified = unverifiedPaths(status);
  if (unverified.length > 0) {
    return {
      message: `No sync baseline for ${unverified.join(", ")} — cannot tell whether HubSpot differs`,
      ok: false,
    };
  }
  const inferred = inferredPaths(status);
  if (inferred.length > 0) {
    return { message: "No newer changes on HubSpot (compared against local file times)", ok: true };
  }
  return { message: "HubSpot matches your local copy", ok: true };
}

/** Per-path hint for the fetch menu when nothing under it drifted. */
export function describeBaseline(kind: BaselineKind | undefined): string {
  if (kind === "missing") return "no baseline — unverified";
  if (kind === "diverged") return "local copy differs from last sync — unverified";
  if (kind === "inferred") return "up to date (by file times)";
  return "up to date";
}

export interface PathDrift {
  changed: number;
  added: number;
}

/** How much drift sits under each saved path, for per-path hints. */
export function driftByPath(status: RemoteDriftSets, paths: string[]): Map<string, PathDrift> {
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
export function driftLines(status: RemoteDriftSets, limit = 12): string[] {
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
export function describeRemoteStatus(status: RemoteDriftSets): string | undefined {
  const parts: string[] = [];
  if (status.changed.length > 0) {
    parts.push(`${status.changed.length} changed on HubSpot`);
  }
  if (status.added.length > 0) {
    parts.push(`${status.added.length} new`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
