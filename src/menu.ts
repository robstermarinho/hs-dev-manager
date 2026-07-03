import * as p from "@clack/prompts";
import pc from "picocolors";
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
      message: "Selecione o portal",
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
        { value: "configure" as const, label: "Configurar novo path", hint: "baixar path remoto do HubSpot" },
        { value: "fetch" as const, label: "Fetch / atualizar local", hint: "re-download com --overwrite" },
        { value: "watch" as const, label: "Watch", hint: "sync automático ao salvar" },
        { value: "deploy" as const, label: "Deploy", hint: "upload das mudanças + git commit" },
        { value: "history" as const, label: "Histórico de deploys" },
        { value: "remove" as const, label: "Remover path salvo" },
        { value: "portal" as const, label: "Trocar portal" },
        { value: "helper" as const, label: "Ajuda" },
        { value: "exit" as const, label: "Sair" },
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
    fail("Nenhuma conta HubSpot encontrada. Autentique com: hs account auth");
  }
  p.log.info(dim(`${discovered.accounts.length} contas · ${discovered.source}`));

  let portal = await selectPortal(discovered.accounts);

  while (true) {
    const action = await mainMenu(portal);

    switch (action) {
      case "portal":
        portal = await selectPortal(discovered.accounts);
        break;
      case "exit":
        p.outro("Até mais!");
        return;
      default:
        p.log.warn(`Ação "${action}" ainda não implementada (próximos passos do plano).`);
        break;
    }
  }
}
