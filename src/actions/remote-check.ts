import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { classifyConflict, type ConflictCheck } from "../conflict.js";
import type { HsAccount } from "../hs/accounts.js";
import { portalKey } from "../hs/accounts.js";
import { fetchRemoteInventory } from "../hs/remote-inventory.js";
import { readRemoteFile, remoteBasename } from "../hs/remote-file.js";
import { listRemote, parentRemote } from "../hs/remote-ls.js";
import { remotePathFor } from "../paths.js";
import { inventoryIndex, inventoryUpdatedFor, isUnchangedSince } from "../remote-status.js";
import { loadRemoteState, sha256, syncedAtLookup, syncedHash } from "../state/remote-state.js";

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
  fetchRemoteInventory?: typeof fetchRemoteInventory;
  onProgress?: (done: number, total: number, file: string) => void;
}

/**
 * Compare each file about to be uploaded against its Design Manager copy.
 *
 * Two listing requests up front give every remote asset's modification time. A
 * file whose remote copy has not moved since our last sync needs no download at
 * all, which is the common case — without it, every file costs its own `hs`
 * process (~1.8s each, mostly CLI startup).
 *
 * The inventory may not cover every asset type, so it is only ever used to skip
 * work: anything it does not mention falls back to `hs cms list` plus a download.
 */
export async function checkRemoteConflicts(
  account: HsAccount,
  files: string[],
  cwd: string = process.cwd(),
  deps: RemoteCheckDeps = {}
): Promise<RemoteConflict[]> {
  const list = deps.listRemote ?? listRemote;
  const readRemote = deps.readRemoteFile ?? readRemoteFile;
  const inventoryOf = deps.fetchRemoteInventory ?? fetchRemoteInventory;
  const state = await loadRemoteState(cwd);
  const key = portalKey(account);
  const syncedAt = syncedAtLookup(state, key);
  const listings = new Map<string, Set<string> | undefined>();
  const results: RemoteConflict[] = [];

  const items = await inventoryOf(account.accountId);
  const inventory = items ? inventoryIndex(items) : undefined;

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

    // Cheapest answer first: the remote timestamp can rule out a conflict
    // without any per-file request.
    const updated = inventory ? inventoryUpdatedFor(inventory, remotePath) : undefined;
    if (updated !== undefined && isUnchangedSince(updated, syncedAt(remotePath))) {
      results.push({ file, remotePath, check: classifyConflict({ localHash, remoteUnchanged: true }) });
      continue;
    }

    // The inventory already proved the file is there, so the directory listing
    // is only needed for assets it does not cover.
    if (updated === undefined) {
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
