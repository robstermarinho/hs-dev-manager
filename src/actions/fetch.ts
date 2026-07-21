import { createInterface } from "node:readline";
import * as p from "@clack/prompts";
import type { HsAccount } from "../hs/accounts.js";
import { portalKey } from "../hs/accounts.js";
import { streamHs } from "../hs/runner.js";
import { stripAnsi } from "../hs/watch-parser.js";
import { changedFiles, commitScoped, isGitRepo } from "../git.js";
import { designManagerUrl, localDirFor, portalScope } from "../paths.js";
import { loadFetchLog, recordFetch, saveFetchLog } from "../state/fetch-log.js";
import {
  addPath,
  loadPathsConfig,
  normalizeRemotePath,
  portalPaths,
  savePathsConfig,
} from "../state/paths-config.js";
import { dim, handleCancel, openUrl } from "../ui.js";

/** Download one remote path with a live file counter; records the fetch time on success. */
export async function fetchRemotePath(account: HsAccount, remotePath: string, cwd: string): Promise<boolean> {
  const localDir = localDirFor(account, remotePath, cwd);
  const spinner = p.spinner();
  spinner.start(`Downloading ${remotePath}`);

  let files = 0;
  const errors: string[] = [];
  const child = streamHs(["cms", "fetch", remotePath, localDir, "--overwrite"], {
    accountId: account.accountId,
    cwd,
  });
  const handleLine = (raw: string): void => {
    const line = stripAnsi(raw);
    if (/^Wrote file /.test(line)) {
      files++;
      spinner.message(`Downloading ${remotePath} ${dim(`· ${files} file(s)`)}`);
    } else if (/\b(error|failed|failure)\b/i.test(line)) {
      errors.push(line);
    }
  };
  if (child.stdout) createInterface({ input: child.stdout }).on("line", handleLine);
  if (child.stderr) createInterface({ input: child.stderr }).on("line", handleLine);

  const result = await child;
  if (result.exitCode === 0) {
    spinner.stop(`Downloaded ${remotePath} ${dim(`· ${files} file(s) → ${localDir}`)}`);
    const log = await loadFetchLog(cwd);
    await saveFetchLog(recordFetch(log, portalKey(account), remotePath), cwd);
    return true;
  }
  spinner.stop(`Failed to download ${remotePath}`, 1);
  for (const line of errors) p.log.error(line);
  return false;
}

const fetchOne = fetchRemotePath;

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
      placeholder: "Leave empty to go back",
    })
  );
  const remotePath = normalizeRemotePath(input ?? "");
  if (!remotePath) {
    p.log.warn("No path entered. Back to menu.");
    return;
  }

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

  // Fetch overwrites local files, so require a clean tree in the portal scope:
  // uncommitted work would be lost and the post-fetch sync commit would swallow it.
  const inRepo = await isGitRepo(cwd);
  const scope = portalScope(account);
  if (inRepo) {
    const dirty = await changedFiles(cwd, scope);
    if (dirty.length > 0) {
      p.log.error(`Uncommitted changes in ${scope} — commit or deploy them before fetching:`);
      for (const file of dirty.slice(0, 10)) p.log.message(dim(`  ${file}`));
      if (dirty.length > 10) p.log.message(dim(`  … and ${dirty.length - 10} more`));
      return;
    }
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

  // Tree was clean before the fetch, so anything changed now came from HubSpot.
  if (inRepo) {
    const synced = await changedFiles(cwd, scope);
    if (synced.length === 0) {
      p.log.info(dim("Local already up to date — nothing to sync."));
      return;
    }
    const message = `chore(hubspot): sync ${targets.join(", ")} from ${account.name}`;
    if (await commitScoped(cwd, scope, message)) {
      p.log.success(`Sync commit created: ${synced.length} file(s)`);
    } else {
      p.log.warn("Sync commit failed — check git status.");
    }
  }
}
