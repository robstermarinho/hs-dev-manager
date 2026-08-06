import * as p from "@clack/prompts";
import type { HsAccount } from "../hs/accounts.js";
import { portalKey } from "../hs/accounts.js";
import { loadPathsConfig, portalPaths } from "../state/paths-config.js";
import { accent, handleCancel, menuLabel, renderTree } from "../ui.js";
import { configurePathAction } from "./fetch.js";
import { removePathAction } from "./remove-path.js";

const CONFIGURE = "__configure__";
const REMOVE = "__remove__";
const BACK = "__back__";

/**
 * Menu action: everything about which remote paths this portal tracks.
 *
 * Grouped away from the daily fetch/watch/deploy flow because it is setup work,
 * and the saved paths are shown on entry instead of hiding behind a separate
 * "list" action.
 */
export async function pathsAction(account: HsAccount, cwd: string = process.cwd()): Promise<void> {
  while (true) {
    const config = await loadPathsConfig(cwd);
    const paths = portalPaths(config, portalKey(account));
    p.note(renderTree(paths), `Saved paths · ${accent(account.name)}`);

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
          { value: BACK, label: menuLabel("back", "Back") },
        ],
      })
    );

    if (choice === BACK) return;
    if (choice === CONFIGURE) await configurePathAction(account, cwd);
    if (choice === REMOVE) await removePathAction(account, cwd);
  }
}
