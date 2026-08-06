import * as p from "@clack/prompts";
import pc from "picocolors";
import { deployAction } from "./actions/deploy.js";
import { fetchAction } from "./actions/fetch.js";
import { helperAction } from "./actions/helper.js";
import { historyAction } from "./actions/history.js";
import { lintAction } from "./actions/lint.js";
import { pathsAction } from "./actions/paths-menu.js";
import { portalLinksAction } from "./actions/portal-links.js";
import { addPortalAction } from "./actions/portal.js";
import { offerHsUpgrade } from "./actions/upgrade.js";
import { watchAction } from "./actions/watch.js";
import { discoverAccounts, type AccountsResult, type HsAccount } from "./hs/accounts.js";
import { checkHsCli, hsInstallHint } from "./hs/version.js";
import { latestSelfVersion, selfUpdateHint, SELF_PACKAGE, SELF_VERSION } from "./self-version.js";
import { loadLastPortalId, saveLastPortalId } from "./state/last-portal.js";
import { renderBanner } from "./banner.js";
import { accent, dim, fail, handleCancel, menuLabel } from "./ui.js";

const ADD_PORTAL = Symbol("add-portal");

export type MenuAction =
  | "paths"
  | "fetch"
  | "watch"
  | "lint"
  | "deploy"
  | "history"
  | "links"
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

export async function mainMenu(portal: HsAccount): Promise<MenuAction> {
  const action = handleCancel(
    await p.select({
      message: `Portal ${accent(portal.name)} ${dim(`(${portal.accountId})`)}`,
      options: [
        // Paths
        {
          value: "paths" as const,
          label: menuLabel("list", "Paths"),
          hint: "list, add or remove the paths this portal tracks",
        },
        // Sync & deploy
        {
          value: "fetch" as const,
          label: menuLabel("fetch", "Fetch / update local"),
          hint: "see what changed on HubSpot",
        },
        { value: "watch" as const, label: menuLabel("watch", "Watch"), hint: "auto-sync on save" },
        {
          value: "lint" as const,
          label: menuLabel("check", "Lint local files"),
          hint: "HubL + JSON syntax, offline",
        },
        { value: "deploy" as const, label: menuLabel("deploy", "Deploy"), hint: "upload changes + git commit" },
        {
          value: "history" as const,
          label: menuLabel("history", "Deploy history"),
          hint: "view past deploys (read-only)",
        },
        // Session
        {
          value: "links" as const,
          label: menuLabel("open", "Open HubSpot"),
          hint: "Design Manager, websites, HubDB, settings, files",
        },
        { value: "helper" as const, label: menuLabel("help", "Help"), hint: "quick-start guide" },
        { value: "portal" as const, label: menuLabel("back", "Back") },
        { value: "exit" as const, label: menuLabel("exit", "Exit") },
      ],
    })
  );
  return action;
}

export async function runApp(): Promise<void> {
  const banner = renderBanner().replaceAll("\n", `\n${pc.gray("│")}  `);
  p.intro(banner);

  // Kick off the self-update lookup now; awaited (already resolved by then) after account discovery.
  const selfLatest = latestSelfVersion();

  let cli = await checkHsCli();
  if (!cli.supported) {
    fail(hsInstallHint(cli));
  }
  p.log.info(dim(`${SELF_PACKAGE} v${SELF_VERSION} · HubSpot CLI v${cli.version}`));
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
      case "paths":
        await pathsAction(portal);
        break;
      case "fetch":
        await fetchAction(portal);
        break;
      case "watch":
        await watchAction(portal, process.cwd(), deployAction);
        break;
      case "lint":
        await lintAction(portal);
        break;
      case "deploy":
        await deployAction(portal);
        break;
      case "history":
        await historyAction(portal);
        break;
      case "links":
        await portalLinksAction(portal);
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
