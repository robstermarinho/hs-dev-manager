import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const REMOTE_STATE_FILE = join("db", "remote-state.json");

/** Content hash of a remote file the last time local and HubSpot were known to match. */
export interface RemoteFileRecord {
  sha256: string;
  synced_at: string;
}

/** Map of `${portalKey}:${remotePath}` → last synced content hash. */
export interface RemoteState {
  files: Record<string, RemoteFileRecord>;
}

export interface RemoteFileHash {
  remotePath: string;
  sha256: string;
}

export function sha256(content: Uint8Array | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function remoteStateKey(portalKey: string, remotePath: string): string {
  return `${portalKey}:${remotePath}`;
}

export function parseRemoteState(text: string): RemoteState {
  try {
    const raw = JSON.parse(text) as unknown;
    const files = (raw as RemoteState)?.files;
    return { files: files && typeof files === "object" ? files : {} };
  } catch {
    return { files: {} };
  }
}

/** Record the synced hash of one or more remote files (returns a new state). */
export function recordRemoteFiles(
  state: RemoteState,
  portalKey: string,
  entries: RemoteFileHash[],
  date: Date = new Date()
): RemoteState {
  if (entries.length === 0) return state;
  const synced_at = date.toISOString();
  const files = { ...state.files };
  for (const entry of entries) {
    files[remoteStateKey(portalKey, entry.remotePath)] = { sha256: entry.sha256, synced_at };
  }
  return { files };
}

/** Last synced hash for a remote file, undefined when it was never synced by this tool. */
export function syncedHash(state: RemoteState, portalKey: string, remotePath: string): string | undefined {
  const record = state.files[remoteStateKey(portalKey, remotePath)];
  return typeof record?.sha256 === "string" ? record.sha256 : undefined;
}

export async function loadRemoteState(cwd: string = process.cwd()): Promise<RemoteState> {
  try {
    return parseRemoteState(await readFile(join(cwd, REMOTE_STATE_FILE), "utf8"));
  } catch {
    return { files: {} };
  }
}

export async function saveRemoteState(state: RemoteState, cwd: string = process.cwd()): Promise<void> {
  const path = join(cwd, REMOTE_STATE_FILE);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
