import { existsSync } from "node:fs";
import * as p from "@clack/prompts";
import type { HsAccount } from "../hs/accounts.js";
import { portalKey } from "../hs/accounts.js";
import { designManagerUrl, localDirFor } from "../paths.js";
import { pathRows, type SavedPathStatus } from "../paths-view.js";
import { lastFetch, loadFetchLog } from "../state/fetch-log.js";
import { loadPathsConfig, portalPaths } from "../state/paths-config.js";
import { accent, dim, handleCancel, menuLabel, openUrl } from "../ui.js";
import { configurePathAction } from "./fetch.js";
import { removePathAction } from "./remove-path.js";

const CONFIGURE = "__configure__";
const REMOVE = "__remove__";
const OPEN = "__open__";
const BACK = "__back__";

/** Local state of every saved path: when it was last fetched, whether it is on disk. */
async function savedPathStatuses(
  account: HsAccount,
  paths: string[],
  cwd: string
): Promise<SavedPathStatus[]> {
  const log = await loadFetchLog(cwd);
  return paths.map((path) => ({
    path,
    lastFetch: lastFetch(log, portalKey(account), path),
    existsLocally: existsLocallyAt(account, path, cwd),
  }));
}

function existsLocallyAt(account: HsAccount, remotePath: string, cwd: string): boolean {
  try {
    return existsSync(localDirFor(account, remotePath, cwd));
  } catch {
    return false;
  }
}

/** The saved paths with their local status, or the empty-state hint. */
function renderSavedPaths(statuses: SavedPathStatus[]): string {
  if (statuses.length === 0) return dim("No saved paths yet — use “Configure new path”.");
  return pathRows(statuses)
    .map((row) => `${row.path}  ${dim(row.detail)}`)
    .join("\n");
}

/**
 * Menu action: everything about which remote paths this portal tracks.
 *
 * Grouped away from the daily fetch/watch/deploy flow because it is setup work,
 * and the saved paths are shown on entry instead of hiding behind a separate
 * "list" action. Deliberately offline: this screen is re-rendered after every
 * sub-action, so a remote check here would put the portal's listing behind each
 * of them. Drift is reported where it is acted on — entering fetch or watch.
 */
export async function pathsAction(account: HsAccount, cwd: string = process.cwd()): Promise<void> {
  while (true) {
    const config = await loadPathsConfig(cwd);
    const paths = portalPaths(config, portalKey(account));
    const statuses = await savedPathStatuses(account, paths, cwd);
    p.note(renderSavedPaths(statuses), `Saved paths · ${accent(account.name)}`);

    const choice = handleCancel(
      await p.select({
        message: `${paths.length} saved path(s)`,
        options: [
          {
            value: CONFIGURE,
            label: menuLabel("add", "Configure new path"),
            hint: "download a remote path from HubSpot",
          },
          ...(paths.length > 0
            ? [
                {
                  value: REMOVE,
                  label: menuLabel("remove", "Remove saved path"),
                  hint: "unregister a path, optionally delete local files",
                },
              ]
            : []),
          {
            value: OPEN,
            label: menuLabel("open", "Open Design Manager"),
            hint: "this portal's files in the browser",
          },
          { value: BACK, label: menuLabel("back", "Back") },
        ],
      })
    );

    if (choice === BACK) return;
    if (choice === CONFIGURE) await configurePathAction(account, cwd);
    if (choice === REMOVE) await removePathAction(account, cwd);
    if (choice === OPEN) {
      const url = designManagerUrl(account);
      if (!(await openUrl(url))) p.log.info(`Open it yourself: ${url}`);
    }
  }
}
