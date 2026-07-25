import * as p from "@clack/prompts";
import pc from "picocolors";
import { deployAction } from "./actions/deploy.js";
import { configurePathAction, fetchAction } from "./actions/fetch.js";
import { helperAction } from "./actions/helper.js";
import { historyAction } from "./actions/history.js";
import { addPortalAction } from "./actions/portal.js";
import { removePathAction } from "./actions/remove-path.js";
import { offerHsUpgrade } from "./actions/upgrade.js";
import { watchAction } from "./actions/watch.js";
import { discoverAccounts, portalKey, type AccountsResult, type HsAccount } from "./hs/accounts.js";
import { checkHsCli, hsInstallHint } from "./hs/version.js";
import { latestSelfVersion, selfUpdateHint } from "./self-version.js";
import { loadLastPortalId, saveLastPortalId } from "./state/last-portal.js";
import { loadPathsConfig, portalPaths } from "./state/paths-config.js";
import { accent, dim, fail, handleCancel, menuLabel, renderTree } from "./ui.js";

const ADD_PORTAL = Symbol("add-portal");

export type MenuAction =
  | "configure"
  | "fetch"
  | "watch"
  | "deploy"
  | "history"
  | "remove"
  | "list"
  | "portal"
  | "helper"
  | "exit";

export async function selectPortal(
  accounts: HsAccount[],
  lastPortalId?: string
): Promise<HsAccount | typeof ADD_PORTAL> {
  const last = lastPortalId ? accounts.find((a) => a.accountId === lastPortalId) : undefined;
  const selected = handleCancel(
    await p.select<HsAccount | typeof ADD_PORTAL>({
      message: "Select a portal",
      options: [
        ...accounts.map((account) => ({
          value: account,
          label: account.name,
          hint:
            account === last
              ? `${account.accountId} · last used`
              : account.isDefault
                ? `${account.accountId} · default`
                : account.accountId,
        })),
        { value: ADD_PORTAL, label: menuLabel("add", "Add portal"), hint: "authenticate a new HubSpot account" },
      ],
      initialValue: last ?? accounts.find((a) => a.isDefault) ?? accounts[0],
    })
  );
  return selected;
}

/**
 * Prompt for a portal, handling the inline "Add portal" choice by running the
 * auth flow and re-selecting. Mutates the passed discovery result in place when
 * new accounts appear so the caller keeps an up-to-date list. Persists the
 * chosen portal to .hsaccount (same file the sh version used).
 */
async function pickPortal(discovered: AccountsResult): Promise<HsAccount> {
  const lastPortalId = await loadLastPortalId();
  while (true) {
    const selected = await selectPortal(discovered.accounts, lastPortalId);
    if (selected !== ADD_PORTAL) {
      await saveLastPortalId(selected);
      return selected;
    }

    const refreshed = await addPortalAction();
    if (refreshed) {
      discovered.accounts = refreshed.accounts;
      discovered.source = refreshed.source;
    }
  }
}

/** Menu action: show the current portal's saved paths as a tree. */
async function listPathsAction(portal: HsAccount, cwd: string = process.cwd()): Promise<void> {
  const config = await loadPathsConfig(cwd);
  const paths = portalPaths(config, portalKey(portal));
  p.note(renderTree(paths), `Saved paths · ${accent(portal.name)}`);
}

export async function mainMenu(portal: HsAccount): Promise<MenuAction> {
  const action = handleCancel(
    await p.select({
      message: `Portal ${accent(portal.name)} ${dim(`(${portal.accountId})`)}`,
      options: [
        // Paths
        {
          value: "configure" as const,
          label: menuLabel("add", "Configure new path"),
          hint: "download a remote path from HubSpot",
        },
        {
          value: "remove" as const,
          label: menuLabel("remove", "Remove saved path"),
          hint: "unregister a path, optionally delete local files",
        },
        {
          value: "list" as const,
          label: menuLabel("list", "List saved paths"),
          hint: "show saved paths for this portal",
        },
        // Sync & deploy
        {
          value: "fetch" as const,
          label: menuLabel("fetch", "Fetch / update local"),
          hint: "re-download with --overwrite",
        },
        { value: "watch" as const, label: menuLabel("watch", "Watch"), hint: "auto-sync on save" },
        { value: "deploy" as const, label: menuLabel("deploy", "Deploy"), hint: "upload changes + git commit" },
        {
          value: "history" as const,
          label: menuLabel("history", "Deploy history"),
          hint: "view past deploys (read-only)",
        },
        // Session
        { value: "helper" as const, label: menuLabel("help", "Help"), hint: "quick-start guide" },
        { value: "portal" as const, label: menuLabel("back", "Back") },
        { value: "exit" as const, label: menuLabel("exit", "Exit") },
      ],
    })
  );
  return action;
}

export async function runApp(): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" hubspot-dev-manager ")));

  // Kick off the self-update lookup now; awaited (already resolved by then) after account discovery.
  const selfLatest = latestSelfVersion();

  let cli = await checkHsCli();
  if (!cli.supported) {
    fail(hsInstallHint(cli));
  }
  p.log.info(dim(`HubSpot CLI v${cli.version}`));
  if (cli.support === "untested") {
    p.log.warn(`HubSpot CLI v${cli.version} is newer than we have tested. Proceeding, but issues are possible.`);
  }
  cli = await offerHsUpgrade(cli);

  const discovered = await discoverAccounts();
  if (!discovered || discovered.accounts.length === 0) {
    fail("No HubSpot accounts found. Authenticate with: hs account auth");
  }
  p.log.info(dim(`${discovered.accounts.length} accounts · ${discovered.source}`));

  const latest = await selfLatest;
  const hint = latest ? selfUpdateHint(latest) : undefined;
  if (hint) p.log.warn(hint);

  let portal = await pickPortal(discovered);

  while (true) {
    const action = await mainMenu(portal);

    switch (action) {
      case "configure":
        await configurePathAction(portal);
        break;
      case "fetch":
        await fetchAction(portal);
        break;
      case "watch":
        await watchAction(portal, process.cwd(), deployAction);
        break;
      case "deploy":
        await deployAction(portal);
        break;
      case "history":
        await historyAction(portal);
        break;
      case "remove":
        await removePathAction(portal);
        break;
      case "list":
        await listPathsAction(portal);
        break;
      case "helper":
        await helperAction();
        break;
      case "portal":
        portal = await pickPortal(discovered);
        break;
      case "exit":
        p.outro("Bye!");
        return;
    }
  }
}
