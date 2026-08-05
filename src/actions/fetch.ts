import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import * as p from "@clack/prompts";
import { countLocalFiles, renderFetchComplete, renderFetchProgress } from "../fetch-progress.js";
import type { HsAccount } from "../hs/accounts.js";
import { portalKey } from "../hs/accounts.js";
import { streamHs } from "../hs/runner.js";
import { stripAnsi } from "../hs/watch-parser.js";
import { changedFiles, commitScoped, isGitRepo } from "../git.js";
import { designManagerUrl, localDirFor, portalScope, remotePathFor } from "../paths.js";
import { loadFetchLog, recordFetch, saveFetchLog } from "../state/fetch-log.js";
import {
  loadRemoteState,
  recordRemoteFiles,
  saveRemoteState,
  sha256,
  type RemoteFileHash,
} from "../state/remote-state.js";
import {
  addPath,
  loadPathsConfig,
  normalizeRemotePath,
  portalPaths,
  savePathsConfig,
} from "../state/paths-config.js";
import { dim, handleCancel, menuLabel, openUrl } from "../ui.js";
import { browseRemotePath } from "./browse.js";

export interface PortalGitState {
  inRepo: boolean;
  scope: string;
  dirty: string[];
}

export async function portalGitState(account: HsAccount, cwd: string): Promise<PortalGitState> {
  const scope = portalScope(account);
  const inRepo = await isGitRepo(cwd);
  return { inRepo, scope, dirty: inRepo ? await changedFiles(cwd, scope) : [] };
}

export function reportDirtyPortal(state: PortalGitState): void {
  p.log.error(`Uncommitted changes in ${state.scope} — commit or deploy them before overwriting:`);
  for (const file of state.dirty.slice(0, 10)) p.log.message(dim(`  ${file}`));
  if (state.dirty.length > 10) p.log.message(dim(`  … and ${state.dirty.length - 10} more`));
}

/**
 * Remember the content just downloaded: it is, by definition, the current remote
 * content, so a later deploy can tell HubSpot-side edits from our own.
 */
async function recordSyncedFetch(account: HsAccount, writtenPaths: string[], cwd: string): Promise<void> {
  const entries: RemoteFileHash[] = [];
  for (const written of writtenPaths) {
    const absolute = resolve(cwd, written);
    const remotePath = remotePathFor(account, relative(cwd, absolute).replaceAll("\\", "/"));
    if (!remotePath) continue;
    try {
      entries.push({ remotePath, sha256: sha256(await readFile(absolute)) });
    } catch {
      // Unreadable file: leave it unrecorded, it just stays unverified on deploy.
    }
  }
  if (entries.length === 0) return;
  try {
    const state = await loadRemoteState(cwd);
    await saveRemoteState(recordRemoteFiles(state, portalKey(account), entries), cwd);
  } catch (error) {
    p.log.warn(`Could not record the remote sync state: ${error instanceof Error ? error.message : error}`);
  }
}

/** Download one remote path with a live file counter; records the fetch time on success. */
export async function fetchRemotePath(account: HsAccount, remotePath: string, cwd: string): Promise<boolean> {
  let localDir: string;
  try {
    localDir = localDirFor(account, remotePath, cwd);
  } catch (error) {
    p.log.error(error instanceof Error ? error.message : String(error));
    return false;
  }
  const localBaseline = await countLocalFiles(localDir);
  const spinner = p.spinner();
  spinner.start(`Downloading ${remotePath} ${dim(renderFetchProgress(0, localBaseline))}`);

  let files = 0;
  const written: string[] = [];
  const errors: string[] = [];
  const child = streamHs(["cms", "fetch", remotePath, localDir, "--overwrite"], {
    accountId: account.accountId,
    cwd,
  });
  const handleLine = (raw: string): void => {
    const line = stripAnsi(raw);
    const wrote = line.match(/^Wrote file (.+)$/);
    if (wrote?.[1]) {
      files++;
      written.push(wrote[1].trim());
      spinner.message(`Downloading ${remotePath} ${dim(renderFetchProgress(files, localBaseline))}`);
    } else if (/\b(error|failed|failure)\b/i.test(line)) {
      errors.push(line);
    }
  };
  if (child.stdout) createInterface({ input: child.stdout }).on("line", handleLine);
  if (child.stderr) createInterface({ input: child.stderr }).on("line", handleLine);

  const result = await child;
  if (result.exitCode === 0) {
    const localTotal = await countLocalFiles(localDir);
    spinner.stop(`Downloaded ${remotePath} ${dim(`${renderFetchComplete(Math.max(files, localTotal))} · ${localDir}`)}`);
    const log = await loadFetchLog(cwd);
    await saveFetchLog(recordFetch(log, portalKey(account), remotePath), cwd);
    await recordSyncedFetch(account, written, cwd);
    return true;
  }
  spinner.stop(`Failed to download ${remotePath}`, 1);
  for (const line of errors) p.log.error(line);
  return false;
}

export type FetchRemoteFn = typeof fetchRemotePath;

/** Ask for a remote path by browsing the Design Manager or typing it. */
async function pickRemotePath(account: HsAccount): Promise<string | undefined> {
  const BROWSE = "browse";
  const TYPE = "type";
  const OPEN = "open";
  const BACK = "back";
  const dmUrl = designManagerUrl(account);

  while (true) {
    const mode = handleCancel(
      await p.select<string>({
        message: "How do you want to pick the remote path?",
        options: [
          {
            value: BROWSE,
            label: menuLabel("browse", "Browse Design Manager"),
            hint: "navigate remote folders via hs cms ls",
          },
          {
            value: TYPE,
            label: menuLabel("type", "Type path manually"),
            hint: "e.g. /my-theme or /marketing/templates",
          },
          { value: OPEN, label: menuLabel("open", "Open Design Manager in browser"), hint: dmUrl },
          { value: BACK, label: menuLabel("back", "Back") },
        ],
      })
    );

    if (mode === BACK) return undefined;
    if (mode === OPEN) {
      if (!(await openUrl(dmUrl))) p.log.warn(`Could not open the browser. Visit: ${dmUrl}`);
      continue;
    }
    if (mode === BROWSE) {
      const picked = await browseRemotePath(account);
      if (picked) return picked;
      continue; // cancelled or listing failed — back to mode choice
    }

    const input = handleCancel(
      await p.text({
        message: "Design Manager remote path (e.g. /my-theme or /marketing/templates)",
        placeholder: "Leave empty to go back",
        validate: (value) =>
          value?.trim() && !normalizeRemotePath(value)
            ? "Enter a valid HubSpot path without backslashes, . or .. segments"
            : undefined,
      })
    );
    const typed = normalizeRemotePath(input ?? "");
    if (typed) return typed;
  }
}

/** Menu action: download a new remote path and register it in paths-config.json. */
export async function configurePathAction(
  account: HsAccount,
  cwd: string = process.cwd(),
  fetcher: FetchRemoteFn = fetchRemotePath
): Promise<void> {
  // Configure also uses --overwrite and its initial commit spans the portal.
  // Require a clean portal scope up front — before the user spends time
  // browsing for a path — so existing work cannot be overwritten or
  // accidentally included in that commit.
  const gitState = await portalGitState(account, cwd);
  if (gitState.dirty.length > 0) {
    reportDirtyPortal(gitState);
    return;
  }

  const remotePath = await pickRemotePath(account);
  if (!remotePath) {
    p.log.warn("No path selected. Back to menu.");
    return;
  }

  const config = await loadPathsConfig(cwd);
  const key = portalKey(account);
  const isNew = !portalPaths(config, key).includes(remotePath);

  if (!(await fetcher(account, remotePath, cwd))) return;

  if (isNew) {
    await savePathsConfig(addPath(config, key, remotePath), cwd);
    p.log.success("Path saved to paths-config.json");
    if (gitState.inRepo) {
      const committed = await commitScoped(cwd, portalScope(account), `chore(hubspot): init local download ${remotePath}`);
      if (committed) p.log.info(dim("Initial commit created"));
    }
  }
}

/** Menu action: re-download one or all saved paths with --overwrite. */
export async function fetchAction(
  account: HsAccount,
  cwd: string = process.cwd(),
  fetcher: FetchRemoteFn = fetchRemotePath
): Promise<void> {
  const config = await loadPathsConfig(cwd);
  const paths = portalPaths(config, portalKey(account));

  if (paths.length === 0) {
    p.log.warn('No saved paths for this portal. Use "Configure new path" first.');
    return;
  }

  // Fetch overwrites local files, so require a clean tree in the portal scope:
  // uncommitted work would be lost and the post-fetch sync commit would swallow it.
  const gitState = await portalGitState(account, cwd);
  if (gitState.dirty.length > 0) {
    reportDirtyPortal(gitState);
    return;
  }

  const ALL = "__all__";
  const BACK = "__back__";
  const choice = handleCancel(
    await p.select({
      message: "Which path to update? (overwrites local changes)",
      options: [
        ...paths.map((path) => ({ value: path, label: menuLabel("path", path) })),
        ...(paths.length > 1 ? [{ value: ALL, label: menuLabel("all", `All (${paths.length})`) }] : []),
        { value: BACK, label: menuLabel("back", "Back") },
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
    if (!(await fetcher(account, remotePath, cwd))) failures++;
  }
  if (failures === 0) {
    p.log.success(`${targets.length} path(s) updated`);
  } else {
    p.log.warn(`${failures} of ${targets.length} path(s) failed`);
  }

  // Tree was clean before the fetch, so anything changed now came from HubSpot.
  if (gitState.inRepo) {
    const synced = await changedFiles(cwd, gitState.scope);
    if (synced.length === 0) {
      p.log.info(dim("Local already up to date — nothing to sync."));
      return;
    }
    if (failures > 0) {
      p.log.warn(
        `Fetch was incomplete. ${synced.length} changed file(s) were left uncommitted for review; no sync commit was created.`
      );
      return;
    }
    const message = `chore(hubspot): sync ${targets.join(", ")} from ${account.name}`;
    if (await commitScoped(cwd, gitState.scope, message)) {
      p.log.success(`Sync commit created: ${synced.length} file(s)`);
    } else {
      p.log.warn("Sync commit failed — check git status.");
    }
  }
}
