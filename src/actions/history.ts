import * as p from "@clack/prompts";
import pc from "picocolors";
import type { HsAccount } from "../hs/accounts.js";
import { loadHistory } from "../state/history.js";
import { dim } from "../ui.js";

const SHOW_LAST = 10;

/** Menu action: show the most recent deploys for the selected portal. */
export async function historyAction(account: HsAccount, cwd: string = process.cwd()): Promise<void> {
  const history = await loadHistory(cwd);
  const deploys = history.deploys.filter((d) => d.portal_id === account.accountId).slice(0, SHOW_LAST);

  if (deploys.length === 0) {
    p.log.warn(`No deploys recorded for ${account.name}.`);
    return;
  }

  const lines = deploys.map((deploy) => {
    const status = deploy.status === "success" ? pc.green("✔") : pc.yellow("◐");
    return `${status} ${deploy.timestamp}  ${deploy.message}\n  ${dim(`${deploy.file_count} file(s): ${deploy.files.join(", ")}`)}`;
  });
  p.note(lines.join("\n"), `Last ${deploys.length} deploy(s) — ${account.name}`);
}
