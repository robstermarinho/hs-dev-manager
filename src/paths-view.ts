import { timeAgo } from "./state/fetch-log.js";
import { shortenPath } from "./ui.js";

/**
 * What the Paths screen knows about a saved path without touching the network.
 * Both facts come from local state: `db/fetch-log.json` and the portal directory.
 */
export interface SavedPathStatus {
  path: string;
  lastFetch?: Date;
  existsLocally: boolean;
}

/** "2h ago" for a path that was fetched, said plainly when it never was. */
export function describeFetchAge(lastFetch: Date | undefined, now: Date = new Date()): string {
  return lastFetch ? `fetched ${timeAgo(lastFetch, now)}` : "never fetched";
}

/**
 * A path can be saved without existing on disk — configured on another machine,
 * or deleted locally — and that is worth saying out loud, since fetch is the
 * only thing that will bring it back.
 */
export function describeLocalState(existsLocally: boolean): string {
  return existsLocally ? "downloaded" : "not downloaded";
}

export interface PathRow {
  /** Path column, padded so the details line up across rows. */
  path: string;
  /** Everything after it, meant to be dimmed by the caller. */
  detail: string;
}

/**
 * One row per saved path. Only the path column is padded: the detail is free
 * text, so the caller can colour it without breaking the alignment.
 */
export function pathRows(statuses: SavedPathStatus[], now: Date = new Date()): PathRow[] {
  const labels = statuses.map((status) => shortenPath(status.path));
  const width = Math.max(0, ...labels.map((label) => label.length));

  return statuses.map((status, index) => ({
    path: (labels[index] ?? status.path).padEnd(width),
    detail: `${describeFetchAge(status.lastFetch, now)} · ${describeLocalState(status.existsLocally)}`,
  }));
}
