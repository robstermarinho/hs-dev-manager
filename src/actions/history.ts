import * as p from "@clack/prompts";
import pc from "picocolors";
import type { HsAccount } from "../hs/accounts.js";
import { alignRows, deployAge, deployRow, scopeRelative } from "../history-view.js";
import { portalScope } from "../paths.js";
import { loadHistory, type DeployRecord } from "../state/history.js";
import { accent, dim, handleCancel, menuLabel, renderTree } from "../ui.js";

const PAGE_SIZE = 10;
const MORE = "__more__";
const BACK = "__back__";

function statusIcon(deploy: DeployRecord): string {
  return deploy.status === "success" ? pc.green("✔") : pc.yellow("◐");
}

/** Full record of one deploy: what, where, when, and the file tree. */
function showDeploy(deploy: DeployRecord, scope: string): void {
  const files = deploy.files.map((file) => scopeRelative(file, scope));
  const header = [
    deploy.message,
    dim(
      `${deploy.status === "success" ? "uploaded" : "partial upload"} · ${deploy.file_count} file(s) · ${deploy.portal} (${deploy.portal_id})`
    ),
    "",
    renderTree(files),
  ].join("\n");
  p.note(header, `${statusIcon(deploy)} ${deploy.timestamp} ${dim(`(${deployAge(deploy.timestamp)})`)}`);
}

/** Menu action: browse past deploys for the selected portal. */
export async function historyAction(account: HsAccount, cwd: string = process.cwd()): Promise<void> {
  const history = await loadHistory(cwd);
  const deploys = history.deploys.filter((deploy) => deploy.portal_id === account.accountId);

  if (deploys.length === 0) {
    p.log.warn(`No deploys recorded for ${account.name}.`);
    return;
  }

  const scope = portalScope(account);
  let shown = Math.min(PAGE_SIZE, deploys.length);

  while (true) {
    const visible = deploys.slice(0, shown);
    const rows = alignRows(visible.map((deploy) => deployRow(deploy, scope)));

    const choice = handleCancel(
      await p.select({
        message: `Deploy history · ${accent(account.name)} ${dim(`(${shown} of ${deploys.length})`)}`,
        options: [
          ...visible.map((deploy, index) => {
            const row = rows[index] as { age: string; files: string; summary: string };
            return {
              value: String(index),
              label: `${statusIcon(deploy)} ${row.age}  ${dim(row.files)}  ${row.summary}`,
              hint: deploy.message,
            };
          }),
          ...(shown < deploys.length
            ? [
                {
                  value: MORE,
                  label: menuLabel("fetch", `Show ${Math.min(PAGE_SIZE, deploys.length - shown)} more`),
                  hint: `${deploys.length - shown} older deploy(s)`,
                },
              ]
            : []),
          { value: BACK, label: menuLabel("back", "Back") },
        ],
      })
    );

    if (choice === BACK) return;
    if (choice === MORE) {
      shown = Math.min(shown + PAGE_SIZE, deploys.length);
      continue;
    }

    // Anything other than a row index leaves the browser instead of re-prompting.
    const deploy = visible[Number(choice)];
    if (!deploy) return;
    showDeploy(deploy, scope);
  }
}
