import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const FETCH_LOG_FILE = join("db", "fetch-log.json");

/** Map of `${portalKey}:${remotePath}` → ISO timestamp of the last successful fetch. */
export interface FetchLog {
  fetches: Record<string, string>;
}

export function parseFetchLog(text: string): FetchLog {
  try {
    const raw = JSON.parse(text) as unknown;
    const fetches = (raw as FetchLog)?.fetches;
    return { fetches: fetches && typeof fetches === "object" ? fetches : {} };
  } catch {
    return { fetches: {} };
  }
}

export function fetchLogKey(portalKey: string, remotePath: string): string {
  return `${portalKey}:${remotePath}`;
}

export function recordFetch(log: FetchLog, portalKey: string, remotePath: string, date: Date = new Date()): FetchLog {
  return { fetches: { ...log.fetches, [fetchLogKey(portalKey, remotePath)]: date.toISOString() } };
}

export function lastFetch(log: FetchLog, portalKey: string, remotePath: string): Date | undefined {
  const iso = log.fetches[fetchLogKey(portalKey, remotePath)];
  if (!iso) return undefined;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Human-readable age, e.g. "2h ago", "3d ago". */
export function timeAgo(from: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export async function loadFetchLog(cwd: string = process.cwd()): Promise<FetchLog> {
  try {
    return parseFetchLog(await readFile(join(cwd, FETCH_LOG_FILE), "utf8"));
  } catch {
    return { fetches: {} };
  }
}

export async function saveFetchLog(log: FetchLog, cwd: string = process.cwd()): Promise<void> {
  const path = join(cwd, FETCH_LOG_FILE);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(log, null, 2)}\n`, "utf8");
}
