import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import * as p from "@clack/prompts";
import pc from "picocolors";
import type { HsAccount } from "../hs/accounts.js";
import { portalKey } from "../hs/accounts.js";
import { streamHs } from "../hs/runner.js";
import { parseWatchLine } from "../hs/watch-parser.js";
import { changedFiles, commitScoped, isGitRepo } from "../git.js";
import { localDirFor, portalScope } from "../paths.js";
import {
  describeRemoteStatus,
  driftLines,
  isRemoteCheckDisabled,
  isUnder,
  type RemoteStatus,
} from "../remote-status.js";
import { lastFetch, loadFetchLog, timeAgo } from "../state/fetch-log.js";
import { loadPathsConfig, portalPaths } from "../state/paths-config.js";
import { dim, handleCancel, menuLabel } from "../ui.js";
import {
  destinationFor,
  driftTargets,
  fetchRemotePath,
  markPathSynced,
  portalGitState,
  reportDirtyPortal,
} from "./fetch.js";
import { computeRemoteStatus } from "./remote-status.js";
import { applyEvent, createWatchStats, summaryLines } from "./watch-monitor.js";

export type DeployFn = (account: HsAccount, cwd: string) => Promise<void>;

interface SyncJob {
  remotePath: string;
  destination?: string;
}

/**
 * Re-download before watching, refusing to overwrite uncommitted work.
 *
 * What comes down is committed right away: leaving it in the working tree would
 * block the next fetch on its clean-tree guard and get swept into the deploy
 * offered when the watch stops — for content that came from HubSpot.
 */
async function runSync(account: HsAccount, cwd: string, jobs: SyncJob[]): Promise<boolean> {
  const gitState = await portalGitState(account, cwd);
  if (gitState.dirty.length > 0) {
    reportDirtyPortal(gitState);
    return false;
  }
  for (const job of jobs) {
    if (job.destination) await mkdir(job.destination, { recursive: true });
    if (!(await fetchRemotePath(account, job.remotePath, cwd, { destination: job.destination }))) return false;
  }

  if (!gitState.inRepo) return true;
  const synced = await changedFiles(cwd, gitState.scope);
  if (synced.length === 0) return true;

  const message = `chore(hubspot): sync ${jobs.map((job) => job.remotePath).join(", ")} from ${account.name}`;
  if (await commitScoped(cwd, gitState.scope, message)) {
    p.log.success(`Sync commit created: ${synced.length} file(s)`);
  } else {
    p.log.warn("Sync commit failed — check git status before deploying.");
  }
  return true;
}

/**
 * Decide what to pull down before the watch starts. The remote listing answers
 * whether anything actually moved, so the old blind "fetch first?" question is
 * only asked when that listing is unavailable.
 *
 * Returns false when the watch should not start.
 */
async function syncBeforeWatch(account: HsAccount, remotePath: string, cwd: string): Promise<boolean> {
  const fetched = lastFetch(await loadFetchLog(cwd), portalKey(account), remotePath);
  const age = fetched ? timeAgo(fetched) : "never";

  let scoped: RemoteStatus | undefined;
  if (!isRemoteCheckDisabled()) {
    const spinner = p.spinner();
    spinner.start("Checking HubSpot for changes");
    const status = await computeRemoteStatus(account, cwd);
    if (status) {
      scoped = {
        changed: status.changed.filter((item) => isUnder(item.path, remotePath)),
        added: status.added.filter((item) => isUnder(item.path, remotePath)),
      };
      if (scoped.changed.length + scoped.added.length === 0) {
        spinner.stop(`HubSpot matches your local copy ${dim(`(last fetch: ${age})`)}`);
        return true;
      }
      spinner.stop(`${describeRemoteStatus(scoped)} since your last sync`);
      p.note(driftLines(scoped).map(dim).join("\n"), `Changed on HubSpot · ${remotePath}`);
    } else {
      spinner.stop("Could not check HubSpot for changes", 1);
    }
  }

  // Nothing to go on: fall back to asking, as before the check existed.
  if (!scoped) {
    const doFetch = handleCancel(
      await p.confirm({
        message: `Fetch latest from HubSpot before watching? ${dim(`(last fetch: ${age} — overwrites local changes)`)}`,
        initialValue: false,
      })
    );
    return doFetch ? runSync(account, cwd, [{ remotePath }]) : true;
  }

  const targets = driftTargets(scoped);
  const FULL = "__full__";
  const SKIP = "__skip__";
  const BACK = "__back__";
  const choice = handleCancel(
    await p.select({
      message: "Sync before watching?",
      options: [
        {
          value: "targeted" as const,
          label: menuLabel("fetch", `Download what changed (${targets.length})`),
          hint: "overwrites those local files",
        },
        { value: FULL, label: menuLabel("all", "Full re-download"), hint: `re-downloads ${remotePath}` },
        {
          value: SKIP,
          label: menuLabel("watch", "Watch anyway"),
          hint: "your local copy stays behind HubSpot",
        },
        { value: BACK, label: menuLabel("back", "Back") },
      ],
    })
  );

  if (choice === BACK) return false;
  if (choice === SKIP) return true;
  if (choice === FULL) return runSync(account, cwd, [{ remotePath }]);

  const synced = await runSync(
    account,
    cwd,
    targets.map((item) => ({ remotePath: item.path, destination: destinationFor(account, item, cwd) }))
  );
  // The targeted download covered every flagged asset, so the path is current.
  if (synced) await markPathSynced(account, remotePath, cwd);
  return synced;
}

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
        ...paths.map((path) => ({ value: path, label: menuLabel("path", path) })),
        { value: BACK, label: menuLabel("back", "Back") },
      ],
    })
  );
  if (remotePath === BACK) return;

  let localDir: string;
  try {
    localDir = localDirFor(account, remotePath, cwd);
  } catch (error) {
    p.log.error(error instanceof Error ? error.message : String(error));
    return;
  }
  if (!existsSync(localDir)) {
    p.log.warn(`Local folder not found: ${localDir}. Fetch it first.`);
    return;
  }

  // Watching uploads local edits, so start from a local copy that is not behind.
  if (!(await syncBeforeWatch(account, remotePath, cwd))) return;

  p.note(
    `${pc.cyan(remotePath)}\n${dim("Saved changes upload automatically. Press Ctrl+C to stop.")}`,
    `Watching · ${account.name}`
  );

  const stats = createWatchStats();
  const child = streamHs(["cms", "watch", localDir, remotePath], {
    accountId: account.accountId,
    cwd,
  });

  const handleLine = (line: string): void => {
    const event = parseWatchLine(line);
    if (!event) return;
    const rendered = applyEvent(stats, event, remotePath);
    if (rendered) process.stdout.write(`${rendered}\n`);
  };
  if (child.stdout) createInterface({ input: child.stdout }).on("line", handleLine);
  if (child.stderr) createInterface({ input: child.stderr }).on("line", handleLine);

  // Swallow SIGINT in the parent so Ctrl+C only stops the watch child,
  // returning the user to the menu instead of killing the CLI.
  const swallowSigint = (): void => {
    child.kill("SIGINT");
  };
  process.on("SIGINT", swallowSigint);
  try {
    await child;
  } finally {
    process.removeListener("SIGINT", swallowSigint);
  }

  p.note(summaryLines(stats).join("\n"), `Watch stopped · ${account.name}`);

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
