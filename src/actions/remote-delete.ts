import type { HsAccount } from "../hs/accounts.js";
import { portalKey } from "../hs/accounts.js";
import { fetchRemoteInventory } from "../hs/remote-inventory.js";
import { readRemoteFile, remoteBasename } from "../hs/remote-file.js";
import { listRemote, parentRemote } from "../hs/remote-ls.js";
import { remotePathFor } from "../paths.js";
import { inventoryIndex, inventoryUpdatedFor, isUnchangedSince } from "../remote-status.js";
import { loadRemoteState, sha256, syncedAtLookup, syncedHash } from "../state/remote-state.js";

/**
 * - `safe`: the HubSpot copy is the one this tool last synced
 * - `changed`: someone edited it on HubSpot since — deleting loses that edit
 * - `gone`: it is not on HubSpot anymore, nothing to delete
 * - `unverified`: the remote copy could not be compared
 */
export type DeletionStatus = "safe" | "changed" | "gone" | "unverified";

export interface RemoteDeletion {
  /** Repo-relative local path of the file that was deleted locally. */
  file: string;
  remotePath: string;
  status: DeletionStatus;
  reason: string;
}

export interface RemoteDeletionDeps {
  listRemote?: typeof listRemote;
  readRemoteFile?: typeof readRemoteFile;
  fetchRemoteInventory?: typeof fetchRemoteInventory;
  onProgress?: (done: number, total: number, file: string) => void;
}

/**
 * Compare each locally deleted file against its Design Manager copy before it
 * is deleted there too.
 *
 * Same rule as the upload check: the inventory timestamps are only used to skip
 * work, and anything that cannot be compared is reported as unverified, never
 * as safe. The local file is gone, so the baseline is the hash recorded at the
 * last sync.
 */
export async function checkRemoteDeletions(
  account: HsAccount,
  files: string[],
  cwd: string = process.cwd(),
  deps: RemoteDeletionDeps = {}
): Promise<RemoteDeletion[]> {
  const list = deps.listRemote ?? listRemote;
  const readRemote = deps.readRemoteFile ?? readRemoteFile;
  const inventoryOf = deps.fetchRemoteInventory ?? fetchRemoteInventory;
  const state = await loadRemoteState(cwd);
  const key = portalKey(account);
  const syncedAt = syncedAtLookup(state, key);
  const listings = new Map<string, Set<string> | undefined>();
  const results: RemoteDeletion[] = [];

  const items = await inventoryOf(account.accountId);
  const inventory = items ? inventoryIndex(items) : undefined;

  for (const [index, file] of files.entries()) {
    deps.onProgress?.(index + 1, files.length, file);

    const remotePath = remotePathFor(account, file);
    if (!remotePath) {
      results.push({ file, remotePath: "", status: "unverified", reason: "file is outside the portal directory" });
      continue;
    }

    const updated = inventory ? inventoryUpdatedFor(inventory, remotePath) : undefined;
    if (updated !== undefined && isUnchangedSince(updated, syncedAt(remotePath))) {
      results.push({ file, remotePath, status: "safe", reason: "remote unchanged since last sync" });
      continue;
    }

    // The inventory does not cover every asset type, so its silence is not
    // proof of absence: only a directory listing can say the file is gone.
    if (updated === undefined) {
      const parent = parentRemote(remotePath);
      if (!listings.has(parent)) {
        const entries = await list(account.accountId, parent);
        listings.set(parent, entries ? new Set(entries.map((entry) => entry.name)) : undefined);
      }
      const listing = listings.get(parent);
      if (!listing) {
        results.push({ file, remotePath, status: "unverified", reason: "remote folder could not be listed" });
        continue;
      }
      if (!listing.has(remoteBasename(remotePath))) {
        results.push({ file, remotePath, status: "gone", reason: "already gone on HubSpot" });
        continue;
      }
    }

    const recorded = syncedHash(state, key, remotePath);
    if (recorded === undefined) {
      results.push({
        file,
        remotePath,
        status: "unverified",
        reason: "no sync record — remote content never seen by this tool",
      });
      continue;
    }

    const remote = await readRemote(account.accountId, remotePath);
    if (!remote) {
      results.push({ file, remotePath, status: "unverified", reason: "remote copy could not be read" });
      continue;
    }

    results.push(
      sha256(remote) === recorded
        ? { file, remotePath, status: "safe", reason: "remote unchanged since last sync" }
        : { file, remotePath, status: "changed", reason: "remote changed since last sync" }
    );
  }

  return results;
}
