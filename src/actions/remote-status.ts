import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { HsAccount } from "../hs/accounts.js";
import { portalKey } from "../hs/accounts.js";
import { fetchRemoteInventory } from "../hs/remote-inventory.js";
import { localDirFor } from "../paths.js";
import { isJsonAsset } from "../json-noise.js";
import { applyDivergence, compareRemote, isUnder, type RemoteStatus } from "../remote-status.js";
import { loadPathsConfig, portalPaths } from "../state/paths-config.js";
import { loadRemoteState, type RemoteState, sha256, syncedAtLookup } from "../state/remote-state.js";

/** Depth cap for the mtime scan: enough for any Design Manager tree, cheap to walk. */
const MAX_SCAN_DEPTH = 12;

/**
 * Newest write time under a local path, or the file's own when it is not a
 * directory. Only a fallback baseline, so failures return undefined and leave
 * the asset reported as unverified rather than as up to date.
 */
export function newestMtime(absolute: string, depth = 0): number | undefined {
  try {
    const info = statSync(absolute);
    if (!info.isDirectory() || depth >= MAX_SCAN_DEPTH) return info.mtimeMs;

    let newest = info.mtimeMs;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = newestMtime(join(absolute, entry.name), depth + 1);
      if (child !== undefined && child > newest) newest = child;
    }
    return newest;
  } catch {
    return undefined;
  }
}

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
    if (paths.length === 0) return { changed: [], added: [], baselines: new Map() };

    const items = await fetchRemoteInventory(account.accountId);
    if (!items) return undefined;

    const state = await loadRemoteState(cwd);

    // Repos migrated from the bash version have no sync records at all. Their
    // local files were still written by a download, so the newest local write
    // time is a usable stand-in. Computed lazily — the comparison only asks for
    // it where a recorded sync is missing — and memoized.
    const mtimes = new Map<string, number | undefined>();
    const localModifiedAt = (remotePath: string): number | undefined => {
      if (!mtimes.has(remotePath)) {
        try {
          mtimes.set(remotePath, newestMtime(localDirFor(account, remotePath, cwd)));
        } catch {
          mtimes.set(remotePath, undefined);
        }
      }
      return mtimes.get(remotePath);
    };

    const status = compareRemote({
      items,
      paths,
      syncedAt: syncedAtLookup(state, portalKey(account)),
      localModifiedAt,
      existsLocally: (remotePath) => {
        try {
          return existsSync(localDirFor(account, remotePath, cwd));
        } catch {
          return false;
        }
      },
    });

    return applyDivergence(status, await findDivergedPaths(account, paths, state, cwd));
  } catch {
    return undefined;
  }
}

/**
 * Saved paths whose local files no longer match the content recorded at their
 * last sync — a git revert, a checkout, or an edit made outside the tool. The
 * recorded timestamp then describes content that is no longer on disk, so
 * comparing HubSpot against it would report "in sync" about a copy that is not.
 *
 * JSON assets are skipped: HubSpot re-serializes them with a different key
 * order, so their bytes routinely differ from the recorded ones without any
 * change in meaning (see `json-noise.ts`).
 */
async function findDivergedPaths(
  account: HsAccount,
  paths: string[],
  state: RemoteState,
  cwd: string
): Promise<string[]> {
  const prefix = `${portalKey(account)}:`;
  const diverged = new Set<string>();

  for (const [key, record] of Object.entries(state.files)) {
    if (!key.startsWith(prefix)) continue;
    const remotePath = key.slice(prefix.length);
    if (isJsonAsset(remotePath)) continue;

    const owner = paths.find((path) => isUnder(remotePath, path));
    if (owner === undefined || diverged.has(owner)) continue;

    try {
      const absolute = localDirFor(account, remotePath, cwd);
      if (!existsSync(absolute)) continue; // deleted locally: reported elsewhere
      if (sha256(await readFile(absolute)) !== record.sha256) diverged.add(owner);
    } catch {
      // Unreadable file: not evidence of divergence, so leave the path alone.
    }
  }

  return [...diverged];
}
