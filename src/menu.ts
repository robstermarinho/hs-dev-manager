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
import { discoverAccounts, type AccountsResult, type HsAccount } from "./hs/accounts.js";
import { checkHsCli, hsInstallHint } from "./hs/version.js";
import { accent, dim, fail, handleCancel } from "./ui.js";

const ADD_PORTAL = Symbol("add-portal");

type MenuAction =
  | "configure"
  | "fetch"
  | "watch"
  | "deploy"
  | "history"
  | "remove"
  | "portal"
  | "helper"
  | "exit";

export async function selectPortal(accounts: HsAccount[]): Promise<HsAccount | typeof ADD_PORTAL> {
  const selected = handleCancel(
    await p.select<HsAccount | typeof ADD_PORTAL>({
      message: "Select a portal",
      options: [
        ...accounts.map((account) => ({
          value: account,
          label: account.name,
          hint: account.isDefault ? `${account.accountId} · default` : account.accountId,
        })),
        { value: ADD_PORTAL, label: "+ Add portal", hint: "authenticate a new HubSpot account" },
      ],
      initialValue: accounts.find((a) => a.isDefault) ?? accounts[0],
    })
  );
  return selected;
}

/**
 * Prompt for a portal, handling the inline "Add portal" choice by running the
 * auth flow and re-selecting. Mutates the passed discovery result in place when
 * new accounts appear so the caller keeps an up-to-date list.
 */
async function pickPortal(discovered: AccountsResult): Promise<HsAccount> {
  while (true) {
    const selected = await selectPortal(discovered.accounts);
    if (selected !== ADD_PORTAL) return selected;

    const refreshed = await addPortalAction();
    if (refreshed) {
      discovered.accounts = refreshed.accounts;
      discovered.source = refreshed.source;
    }
  }
}

async function mainMenu(portal: HsAccount): Promise<MenuAction> {
  const action = handleCancel(
    await p.select({
      message: `Portal ${accent(portal.name)} ${dim(`(${portal.accountId})`)}`,
      options: [
        { value: "configure" as const, label: "Configure new path", hint: "download a remote path from HubSpot" },
        { value: "fetch" as const, label: "Fetch / update local", hint: "re-download with --overwrite" },
        { value: "watch" as const, label: "Watch", hint: "auto-sync on save" },
        { value: "deploy" as const, label: "Deploy", hint: "upload changes + git commit" },
        { value: "history" as const, label: "Deploy history", hint: "view past deploys (read-only)" },
        { value: "remove" as const, label: "Remove saved path", hint: "unregister a path, optionally delete local files" },
        { value: "portal" as const, label: "Switch / add portal", hint: "change portal or authenticate a new one" },
        { value: "helper" as const, label: "Help", hint: "quick-start guide" },
        { value: "exit" as const, label: "Exit" },
      ],
    })
  );
  return action;
}

export async function runApp(): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" hubspot-dev-manager ")));

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
