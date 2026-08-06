import { existsSync } from "node:fs";
import type { HsAccount } from "../hs/accounts.js";
import { portalKey } from "../hs/accounts.js";
import { fetchRemoteInventory } from "../hs/remote-inventory.js";
import { localDirFor } from "../paths.js";
import { compareRemote, type RemoteStatus } from "../remote-status.js";
import { loadPathsConfig, portalPaths } from "../state/paths-config.js";
import { loadRemoteState, syncedAtLookup } from "../state/remote-state.js";

/**
 * Read-only comparison of the portal's Design Manager against the local copy.
 * Undefined when it cannot be answered (missing scopes, offline, unreadable
 * state) — callers treat that as "nothing to say" and never as "all clear".
 */
export async function computeRemoteStatus(
  account: HsAccount,
  cwd: string = process.cwd()
): Promise<RemoteStatus | undefined> {
  try {
    const config = await loadPathsConfig(cwd);
    const paths = portalPaths(config, portalKey(account));
    if (paths.length === 0) return { changed: [], added: [] };

    const items = await fetchRemoteInventory(account.accountId);
    if (!items) return undefined;

    const state = await loadRemoteState(cwd);
    return compareRemote({
      items,
      paths,
      syncedAt: syncedAtLookup(state, portalKey(account)),
      existsLocally: (remotePath) => {
        try {
          return existsSync(localDirFor(account, remotePath, cwd));
        } catch {
          return false;
        }
      },
    });
  } catch {
    return undefined;
  }
}
