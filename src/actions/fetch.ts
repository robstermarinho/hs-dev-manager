import * as p from "@clack/prompts";
import type { HsAccount } from "../hs/accounts.js";
import { portalKey } from "../hs/accounts.js";
import { runHs } from "../hs/runner.js";
import { commitScoped, isGitRepo } from "../git.js";
import { designManagerUrl, localDirFor, portalScope } from "../paths.js";
import {
  addPath,
  loadPathsConfig,
  normalizeRemotePath,
  portalPaths,
  savePathsConfig,
} from "../state/paths-config.js";
import { dim, handleCancel, openUrl } from "../ui.js";

async function fetchOne(account: HsAccount, remotePath: string, cwd: string): Promise<boolean> {
  const localDir = localDirFor(account, remotePath, cwd);
  const spinner = p.spinner();
  spinner.start(`Downloading ${remotePath}`);
  const result = await runHs(["cms", "fetch", remotePath, localDir, "--overwrite"], {
    accountId: account.accountId,
    cwd,
  });
  if (result.ok) {
    spinner.stop(`Downloaded ${remotePath} → ${dim(localDir)}`);
    return true;
  }
  spinner.stop(`Failed to download ${remotePath}`, 1);
  const detail = (result.stderr || result.stdout).trim();
  if (detail) p.log.error(detail);
  return false;
}

/** Menu action: download a new remote path and register it in paths-config.json. */
export async function configurePathAction(account: HsAccount, cwd: string = process.cwd()): Promise<void> {
  const dmUrl = designManagerUrl(account);
  p.log.info(`Design Manager: ${dim(dmUrl)}`);
  const open = handleCancel(
    await p.confirm({ message: "Open Design Manager in your browser to find the path?", initialValue: false })
  );
  if (open && !(await openUrl(dmUrl))) {
    p.log.warn(`Could not open the browser. Visit: ${dmUrl}`);
  }

  const input = handleCancel(
    await p.text({
      message: "Design Manager remote path (e.g. /my-theme or /marketing/templates)",
      placeholder: "/remote/path",
      validate: (value) => (normalizeRemotePath(value ?? "") ? undefined : "Enter a path"),
    })
  );
  const remotePath = normalizeRemotePath(input);

  const config = await loadPathsConfig(cwd);
  const key = portalKey(account);
  const isNew = !portalPaths(config, key).includes(remotePath);

  if (!(await fetchOne(account, remotePath, cwd))) return;

  if (isNew) {
    await savePathsConfig(addPath(config, key, remotePath), cwd);
    p.log.success("Path saved to paths-config.json");
    if (await isGitRepo(cwd)) {
      const committed = await commitScoped(cwd, portalScope(account), `chore(hubspot): init local download ${remotePath}`);
      if (committed) p.log.info(dim("Initial commit created"));
    }
  }
}

/** Menu action: re-download one or all saved paths with --overwrite. */
export async function fetchAction(account: HsAccount, cwd: string = process.cwd()): Promise<void> {
  const config = await loadPathsConfig(cwd);
  const paths = portalPaths(config, portalKey(account));

  if (paths.length === 0) {
    p.log.warn('No saved paths for this portal. Use "Configure new path" first.');
    return;
  }

  const ALL = "__all__";
  const BACK = "__back__";
  const choice = handleCancel(
    await p.select({
      message: "Which path to update? (overwrites local changes)",
      options: [
        ...paths.map((path) => ({ value: path, label: path })),
        ...(paths.length > 1 ? [{ value: ALL, label: `All (${paths.length})` }] : []),
        { value: BACK, label: "← Back" },
      ],
    })
  );
  if (choice === BACK) return;

  const confirmed = handleCancel(
    await p.confirm({ message: "Overwrite local files with the HubSpot version?" })
  );
  if (!confirmed) return;

  const targets = choice === ALL ? paths : [choice];
  let failures = 0;
  for (const remotePath of targets) {
    if (!(await fetchOne(account, remotePath, cwd))) failures++;
  }
  if (failures === 0) {
    p.log.success(`${targets.length} path(s) updated`);
  } else {
    p.log.warn(`${failures} of ${targets.length} path(s) failed`);
  }
}
