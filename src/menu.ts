import * as p from "@clack/prompts";
import pc from "picocolors";
import { deployAction } from "./actions/deploy.js";
import { configurePathAction, fetchAction } from "./actions/fetch.js";
import { helperAction } from "./actions/helper.js";
import { historyAction } from "./actions/history.js";
import { removePathAction } from "./actions/remove-path.js";
import { watchAction } from "./actions/watch.js";
import { discoverAccounts, type HsAccount } from "./hs/accounts.js";
import { checkHsCli, hsInstallHint } from "./hs/version.js";
import { accent, dim, fail, handleCancel } from "./ui.js";

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

export async function selectPortal(accounts: HsAccount[]): Promise<HsAccount> {
  const selected = handleCancel(
    await p.select({
      message: "Select a portal",
      options: accounts.map((account) => ({
        value: account,
        label: account.name,
        hint: account.isDefault ? `${account.accountId} · default` : account.accountId,
      })),
      initialValue: accounts.find((a) => a.isDefault) ?? accounts[0],
    })
  );
  return selected as HsAccount;
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
        { value: "history" as const, label: "Deploy history" },
        { value: "remove" as const, label: "Remove saved path" },
        { value: "portal" as const, label: "Switch portal" },
        { value: "helper" as const, label: "Help" },
        { value: "exit" as const, label: "Exit" },
      ],
    })
  );
  return action;
}

export async function runApp(): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" hubspot-dev-manager ")));

  const cli = await checkHsCli();
  if (!cli.supported) {
    fail(hsInstallHint(cli));
  }
  p.log.info(dim(`HubSpot CLI v${cli.version}`));

  const discovered = await discoverAccounts();
  if (!discovered || discovered.accounts.length === 0) {
    fail("No HubSpot accounts found. Authenticate with: hs account auth");
  }
  p.log.info(dim(`${discovered.accounts.length} accounts · ${discovered.source}`));

  let portal = await selectPortal(discovered.accounts);

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
        portal = await selectPortal(discovered.accounts);
        break;
      case "exit":
        p.outro("Bye!");
        return;
    }
  }
}
