import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { classifyConflict, type ConflictCheck } from "../conflict.js";
import type { HsAccount } from "../hs/accounts.js";
import { portalKey } from "../hs/accounts.js";
import { readRemoteFile, remoteBasename } from "../hs/remote-file.js";
import { listRemote, parentRemote } from "../hs/remote-ls.js";
import { remotePathFor } from "../paths.js";
import { loadRemoteState, sha256, syncedHash } from "../state/remote-state.js";

export interface RemoteConflict {
  /** Repo-relative local file. */
  file: string;
  remotePath: string;
  check: ConflictCheck;
  /** Downloaded HubSpot copy, kept for conflicts so the diff needs no second fetch. */
  remoteContent?: Uint8Array;
}

export interface RemoteCheckDeps {
  listRemote?: typeof listRemote;
  readRemoteFile?: typeof readRemoteFile;
  onProgress?: (done: number, total: number, file: string) => void;
}

/**
 * Compare each file about to be uploaded against its Design Manager copy.
 *
 * One `hs cms list` per remote directory (cached) tells which files exist; only
 * those are downloaded for a content comparison, so brand-new files cost nothing.
 */
export async function checkRemoteConflicts(
  account: HsAccount,
  files: string[],
  cwd: string = process.cwd(),
  deps: RemoteCheckDeps = {}
): Promise<RemoteConflict[]> {
  const list = deps.listRemote ?? listRemote;
  const readRemote = deps.readRemoteFile ?? readRemoteFile;
  const state = await loadRemoteState(cwd);
  const key = portalKey(account);
  const listings = new Map<string, Set<string> | undefined>();
  const results: RemoteConflict[] = [];

  for (const [index, file] of files.entries()) {
    deps.onProgress?.(index + 1, files.length, file);

    const remotePath = remotePathFor(account, file);
    if (!remotePath) {
      results.push({
        file,
        remotePath: "",
        check: { status: "unverified", reason: "file is outside the portal directory" },
      });
      continue;
    }

    let localHash: string;
    try {
      localHash = sha256(await readFile(join(cwd, file)));
    } catch {
      results.push({ file, remotePath, check: { status: "unverified", reason: "local file could not be read" } });
      continue;
    }

    const parent = parentRemote(remotePath);
    if (!listings.has(parent)) {
      const entries = await list(account.accountId, parent);
      listings.set(parent, entries ? new Set(entries.map((entry) => entry.name)) : undefined);
    }
    const listing = listings.get(parent);

    // No listing means the remote state is unknown; a listed-but-undownloadable
    // file is equally unknown. Both must not be reported as safe to overwrite.
    if (!listing) {
      results.push({ file, remotePath, check: classifyConflict({ localHash, remoteUnavailable: true }) });
      continue;
    }
    if (!listing.has(remoteBasename(remotePath))) {
      results.push({ file, remotePath, check: classifyConflict({ localHash }) });
      continue;
    }

    const remote = await readRemote(account.accountId, remotePath);
    if (!remote) {
      results.push({ file, remotePath, check: classifyConflict({ localHash, remoteUnavailable: true }) });
      continue;
    }

    const check = classifyConflict({
      localHash,
      remoteHash: sha256(remote),
      syncedHash: syncedHash(state, key, remotePath),
    });
    // Only conflicts can be diffed, so only those hold on to the remote bytes.
    results.push({ file, remotePath, check, ...(check.status === "conflict" ? { remoteContent: remote } : {}) });
  }

  return results;
}

export function conflictsOf(results: RemoteConflict[]): RemoteConflict[] {
  return results.filter((result) => result.check.status === "conflict");
}

export function unverifiedOf(results: RemoteConflict[]): RemoteConflict[] {
  return results.filter((result) => result.check.status === "unverified");
}
