import type { DeployRecord } from "./state/history.js";
import { timeAgo } from "./state/fetch-log.js";
import { shortenPath } from "./ui.js";

/** Parse the stored local timestamp ("YYYY-MM-DD HH:MM:SS"). */
export function parseDeployTimestamp(timestamp: string): Date | undefined {
  const match = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match.map(Number) as number[];
  const date = new Date(
    year as number,
    (month as number) - 1,
    day as number,
    hour as number,
    minute as number,
    second as number
  );
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** "2h ago" for a stored timestamp; the raw value when it cannot be parsed. */
export function deployAge(timestamp: string, now: Date = new Date()): string {
  const date = parseDeployTimestamp(timestamp);
  return date ? timeAgo(date, now) : timestamp;
}

/** Drop the `src/{portal}-{id}/` prefix — it is the same for every row. */
export function scopeRelative(file: string, scope: string): string {
  const prefix = `${scope}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

/** Shortest useful description of a deploy's files: first path, then "+N more". */
export function summarizeFiles(files: string[], scope: string): string {
  const [first, ...rest] = files;
  if (!first) return "no files";
  const head = shortenPath(scopeRelative(first, scope));
  return rest.length > 0 ? `${head} +${rest.length} more` : head;
}

/** Fixed-width count column so the summaries line up in the picker. */
export function fileCountLabel(count: number): string {
  return `${count} file${count === 1 ? "" : "s"}`;
}

export interface DeployRow {
  age: string;
  files: string;
  summary: string;
  ok: boolean;
}

export function deployRow(deploy: DeployRecord, scope: string, now: Date = new Date()): DeployRow {
  return {
    age: deployAge(deploy.timestamp, now),
    files: fileCountLabel(deploy.file_count),
    summary: summarizeFiles(deploy.files, scope),
    ok: deploy.status === "success",
  };
}

/** Pad each column to the widest value so rows read as a table. */
export function alignRows(rows: DeployRow[]): { age: string; files: string; summary: string }[] {
  const ageWidth = Math.max(0, ...rows.map((row) => row.age.length));
  const filesWidth = Math.max(0, ...rows.map((row) => row.files.length));
  return rows.map((row) => ({
    age: row.age.padEnd(ageWidth),
    files: row.files.padEnd(filesWidth),
    summary: row.summary,
  }));
}
