import { existsSync } from "node:fs";
import * as p from "@clack/prompts";
import type { HsAccount } from "../hs/accounts.js";
import { portalKey } from "../hs/accounts.js";
import { spawnHs } from "../hs/runner.js";
import { changedFiles, isGitRepo } from "../git.js";
import { localDirFor, portalScope } from "../paths.js";
import { loadPathsConfig, portalPaths } from "../state/paths-config.js";
import { dim, handleCancel } from "../ui.js";

export type DeployFn = (account: HsAccount, cwd: string) => Promise<void>;

/** Menu action: watch a saved path and live-sync local edits to HubSpot. */
export async function watchAction(
  account: HsAccount,
  cwd: string = process.cwd(),
  deploy?: DeployFn
): Promise<void> {
  const config = await loadPathsConfig(cwd);
  const paths = portalPaths(config, portalKey(account));

  if (paths.length === 0) {
    p.log.warn('No saved paths for this portal. Use "Configure new path" first.');
    return;
  }

  const BACK = "__back__";
  const remotePath = handleCancel(
    await p.select({
      message: "Which path to watch?",
      options: [
        ...paths.map((path) => ({ value: path, label: path })),
        { value: BACK, label: "← Back" },
      ],
    })
  );
  if (remotePath === BACK) return;

  const localDir = localDirFor(account, remotePath, cwd);
  if (!existsSync(localDir)) {
    p.log.warn(`Local folder not found: ${localDir}. Fetch it first.`);
    return;
  }

  p.log.info(`Watching ${remotePath} — saved changes upload automatically. ${dim("Press Ctrl+C to stop.")}`);

  // Swallow SIGINT in the parent so Ctrl+C only stops the watch child,
  // returning the user to the menu instead of killing the CLI.
  const swallowSigint = (): void => {};
  process.on("SIGINT", swallowSigint);
  try {
    await spawnHs(["cms", "watch", localDir, remotePath], {
      accountId: account.accountId,
      cwd,
    });
  } finally {
    process.removeListener("SIGINT", swallowSigint);
  }
  p.log.info("Watch stopped.");

  if (!(await isGitRepo(cwd))) return;
  const changed = await changedFiles(cwd, portalScope(account));
  if (changed.length === 0) return;

  p.log.info(`${changed.length} changed file(s) in ${portalScope(account)}`);
  if (!deploy) {
    p.log.info('Use "Deploy" from the menu to upload and commit them.');
    return;
  }
  const confirmed = handleCancel(await p.confirm({ message: "Deploy these changes now?" }));
  if (confirmed) {
    await deploy(account, cwd);
  }
}
