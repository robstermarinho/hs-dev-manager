import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const HISTORY_FILE = join("db", "deploy-history.json");
export const MAX_DEPLOYS = 50;

/** Same schema as the sh version (snake_case fields) for compatibility. */
export interface DeployRecord {
  timestamp: string;
  portal: string;
  portal_id: string;
  message: string;
  status: "success" | "partial";
  file_count: number;
  files: string[];
  /**
   * Files this deploy deleted on HubSpot. Optional and only written when there
   * are any, so records stay readable by the sh version, which never had it.
   */
  deleted_files?: string[];
}

export interface DeployHistory {
  deploys: DeployRecord[];
}

export function parseHistory(text: string): DeployHistory {
  try {
    const raw = JSON.parse(text) as unknown;
    const deploys = (raw as DeployHistory)?.deploys;
    return { deploys: Array.isArray(deploys) ? deploys : [] };
  } catch {
    return { deploys: [] };
  }
}

/** Prepend the new record and keep only the most recent MAX_DEPLOYS. */
export function addDeploy(history: DeployHistory, record: DeployRecord): DeployHistory {
  return { deploys: [record, ...history.deploys].slice(0, MAX_DEPLOYS) };
}

export function timestampNow(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export async function loadHistory(cwd: string = process.cwd()): Promise<DeployHistory> {
  try {
    return parseHistory(await readFile(join(cwd, HISTORY_FILE), "utf8"));
  } catch {
    return { deploys: [] };
  }
}

export async function saveHistory(history: DeployHistory, cwd: string = process.cwd()): Promise<void> {
  const path = join(cwd, HISTORY_FILE);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(history, null, 2)}\n`, "utf8");
}
