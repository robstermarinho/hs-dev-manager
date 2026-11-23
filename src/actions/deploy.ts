import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as p from "@clack/prompts";
import type { HsAccount } from "../hs/accounts.js";
import { portalKey } from "../hs/accounts.js";
import { runHs } from "../hs/runner.js";
import { diffRemoteAgainstLocal } from "../diff.js";
import { changedFiles, commitScoped, isGitRepo } from "../git.js";
import { countIssues, errorsOf, renderLintResults } from "../lint.js";
import { portalScope, remotePathFor } from "../paths.js";
import { isRemoteCheckDisabled, REMOTE_CHECK_ENV } from "../remote-status.js";
import { addDeploy, loadHistory, saveHistory, timestampNow } from "../state/history.js";
import {
  forgetRemoteFiles,
  loadRemoteState,
  recordRemoteFiles,
  saveRemoteState,
  sha256,
} from "../state/remote-state.js";
import { colorizeDiff, dim, handleCancel, menuLabel } from "../ui.js";
import { NO_DELETIONS, planDeletions, runDeletions } from "./deploy-delete.js";
import { lintFiles } from "./lint.js";
import { checkRemoteConflicts, conflictsOf, unverifiedOf, type RemoteConflict } from "./remote-check.js";

const IGNORE_PATTERNS = [/(^|\/)\.DS_Store$/, /\.log$/, /(^|\/)\.git(\/|$)/];

/** Files worth uploading: not ignored junk. */
export function filterDeployable(files: string[]): string[] {
  return files.filter((file) => !IGNORE_PATTERNS.some((pattern) => pattern.test(file)));
}

function renderConflictList(results: RemoteConflict[]): string {
  return results.map((result) => `  ${result.file} — ${result.check.reason}`).join("\n");
}

/**
 * Lint the selection before it reaches HubSpot. Returns the files still meant to
 * be uploaded, or undefined when the deploy should be aborted.
 */
async function resolveLintErrors(files: string[], cwd: string): Promise<string[] | undefined> {
  const spinner = p.spinner();
  spinner.start("Linting selected files");
  const results = await lintFiles(files, cwd);
  const broken = errorsOf(results);
  const warnings = countIssues(results, "warning");
  spinner.stop(
    broken.length === 0
      ? `Linted ${results.length} file(s) — no errors`
      : `Linted ${results.length} file(s) — ${broken.length} with errors`
  );

  if (broken.length === 0) {
    if (warnings > 0) p.note(renderLintResults(results), `Lint warnings (${warnings})`);
    return files;
  }

  p.log.error(`Lint errors — uploading these would break the template on HubSpot:\n${renderLintResults(broken)}`);

  const choice = handleCancel(
    await p.select({
      message: "How do you want to handle the lint errors?",
      options: [
        {
          value: "skip" as const,
          label: menuLabel("remove", `Skip file(s) with errors (${broken.length})`),
          hint: "deploy the rest",
        },
        { value: "deploy" as const, label: menuLabel("deploy", "Deploy anyway"), hint: "upload the broken file too" },
        { value: "cancel" as const, label: menuLabel("exit", "Cancel deploy") },
      ],
    })
  );

  if (choice === "cancel") return undefined;
  if (choice === "deploy") return files;

  const failed = new Set(broken.map((result) => result.file));
  const remaining = files.filter((file) => !failed.has(file));
  if (remaining.length === 0) p.log.warn("Every selected file failed lint — nothing left to deploy.");
  return remaining;
}

/**
 * Compare the selection against the Design Manager copies and let the user
 * resolve divergences. Returns the files still meant to be uploaded, or
 * undefined when the deploy should be aborted.
 */
async function resolveRemoteConflicts(
  account: HsAccount,
  files: string[],
  cwd: string
): Promise<string[] | undefined> {
  const spinner = p.spinner();
  spinner.start("Checking HubSpot for remote changes");
  const results = await checkRemoteConflicts(account, files, cwd, {
    onProgress: (done, total, file) => spinner.message(`[${done}/${total}] Checking ${file}`),
  });
  const conflicts = conflictsOf(results);
  const unverified = unverifiedOf(results);
  spinner.stop(
    conflicts.length === 0
      ? "Remote check complete — no conflicts"
      : `Remote check complete — ${conflicts.length} conflict(s)`
  );

  if (unverified.length > 0) {
    p.log.warn(`Could not verify ${unverified.length} file(s) against HubSpot:\n${renderConflictList(unverified)}`);
  }
  if (conflicts.length === 0) return files;

  p.log.warn(
    `These files changed on HubSpot since your last sync — uploading overwrites those edits:\n${renderConflictList(conflicts)}`
  );

  while (true) {
    const choice = handleCancel(
      await p.select({
        message: "How do you want to handle the remote changes?",
        options: [
          {
            value: "diff" as const,
            label: menuLabel("list", "Show diff (HubSpot → local)"),
            hint: "what the upload would overwrite",
          },
          {
            value: "skip" as const,
            label: menuLabel("remove", `Skip conflicted file(s) (${conflicts.length})`),
            hint: "deploy the rest",
          },
          {
            value: "overwrite" as const,
            label: menuLabel("deploy", "Overwrite remote anyway"),
            hint: "HubSpot edits are lost",
          },
          { value: "cancel" as const, label: menuLabel("exit", "Cancel deploy") },
        ],
      })
    );

    if (choice === "diff") {
      await showConflictDiff(conflicts, cwd);
      continue;
    }
    if (choice === "cancel") return undefined;
    if (choice === "overwrite") return files;

    const conflicted = new Set(conflicts.map((result) => result.file));
    const remaining = files.filter((file) => !conflicted.has(file));
    if (remaining.length === 0) p.log.warn("Every selected file is conflicted — nothing left to deploy.");
    return remaining;
  }
}

/** Render the HubSpot → local diff of one conflicted file, asking which when several. */
async function showConflictDiff(conflicts: RemoteConflict[], cwd: string): Promise<void> {
  const BACK = "__back__";
  let target = conflicts[0];

  if (conflicts.length > 1) {
    const picked = handleCancel(
      await p.select({
        message: "Diff which file?",
        options: [
          ...conflicts.map((conflict) => ({ value: conflict.file, label: menuLabel("path", conflict.file) })),
          { value: BACK, label: menuLabel("back", "Back") },
        ],
      })
    );
    if (picked === BACK) return;
    target = conflicts.find((conflict) => conflict.file === picked);
  }

  if (!target?.remoteContent) {
    p.log.warn("The HubSpot copy is no longer available for a diff.");
    return;
  }

  const diff = await diffRemoteAgainstLocal(target.remoteContent, join(cwd, target.file));
  if (!diff) {
    p.log.warn(`No text diff available for ${target.file} (binary file or git could not compare it).`);
    return;
  }
  p.note(colorizeDiff(diff), `hubspot → local · ${target.file}`);
}

/**
 * Remember what this deploy left on HubSpot: an uploaded file's local content is
 * now the remote content, so the next deploy can tell HubSpot-side edits from
 * our own, and a deleted file has no remote copy left to compare against.
 */
async function recordSyncState(account: HsAccount, uploaded: string[], deleted: string[], cwd: string): Promise<void> {
  const entries: { remotePath: string; sha256: string }[] = [];
  for (const file of uploaded) {
    const remotePath = remotePathFor(account, file);
    if (!remotePath) continue;
    try {
      entries.push({ remotePath, sha256: sha256(await readFile(join(cwd, file))) });
    } catch {
      // Unreadable right after a successful upload: skip, it stays unverified.
    }
  }
  const removed = deleted
    .map((file) => remotePathFor(account, file))
    .filter((remotePath): remotePath is string => Boolean(remotePath));
  if (entries.length === 0 && removed.length === 0) return;
  try {
    const key = portalKey(account);
    const state = forgetRemoteFiles(recordRemoteFiles(await loadRemoteState(cwd), key, entries), key, removed);
    await saveRemoteState(state, cwd);
  } catch (error) {
    p.log.warn(`Could not record the remote sync state: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Pick the files to upload, then lint them and compare them against HubSpot.
 * Returns the files still meant to be uploaded (possibly none), or undefined
 * when the deploy should be aborted.
 */
async function resolveUploads(account: HsAccount, uploadable: string[], cwd: string): Promise<string[] | undefined> {
  const selected =
    uploadable.length === 1
      ? uploadable
      : handleCancel(
          await p.multiselect({
            message: "Files to deploy (space to toggle, enter to confirm)",
            options: uploadable.map((file) => ({ value: file, label: file })),
            initialValues: uploadable,
            required: true,
          })
        );

  p.note(selected.map((file) => dim(file)).join("\n"), `${selected.length} file(s) to deploy`);

  // Cheapest gate first: broken syntax is worth catching before any network call.
  const linted = await resolveLintErrors(selected, cwd);
  if (!linted || linted.length === 0) return linted;

  // Ask before spending time on a commit message: the remote may have moved.
  if (isRemoteCheckDisabled()) {
    p.log.warn(
      `${REMOTE_CHECK_ENV} is set: uploading without comparing against HubSpot, so edits made there are overwritten silently.`
    );
    return linted;
  }
  return resolveRemoteConflicts(account, linted, cwd);
}

/** Default commit message for what the deploy is about to do. */
export function defaultDeployMessage(uploads: number, deletions: number, portal: string): string {
  if (uploads === 0) return `feat(hubspot): delete ${deletions} file(s) on ${portal}`;
  if (deletions === 0) return `feat(hubspot): deploy ${uploads} file(s) to ${portal}`;
  return `feat(hubspot): deploy ${uploads} file(s) to ${portal}, delete ${deletions}`;
}

/** Menu action: upload changed files (git-detected), mirror local deletions, and commit both. */
export async function deployAction(account: HsAccount, cwd: string = process.cwd()): Promise<void> {
  if (!(await isGitRepo(cwd))) {
    p.log.warn("Deploy requires a git repository (changes are detected via git status).");
    return;
  }

  const scope = portalScope(account);
  const changed = filterDeployable(await changedFiles(cwd, scope));
  if (changed.length === 0) {
    p.log.warn(`No changes in ${scope}.`);
    return;
  }

  const deleted = changed.filter((file) => !existsSync(join(cwd, file)));
  const uploadable = changed.filter((file) => existsSync(join(cwd, file)));

  let toUpload: string[] = [];
  if (uploadable.length > 0) {
    const resolved = await resolveUploads(account, uploadable, cwd);
    if (!resolved) return;
    toUpload = resolved;
  }

  // Asked last: by now every reason to abort the uploads has come up, so the
  // destructive question is not answered for a deploy that never happens.
  const plan = deleted.length > 0 ? await planDeletions(account, deleted, cwd) : NO_DELETIONS;
  const deletionCount = plan.remote.length + plan.gone.length;
  if (toUpload.length === 0 && deletionCount === 0) return;

  const message = handleCancel(
    await p.text({
      message: "Commit message",
      initialValue: defaultDeployMessage(toUpload.length, deletionCount, account.name),
      validate: (value) => (value?.trim() ? undefined : "Enter a message"),
    })
  );

  if (toUpload.length > 0) {
    const confirmed = handleCancel(
      await p.confirm({ message: `Upload ${toUpload.length} file(s) to ${account.name} (${account.accountId})?` })
    );
    if (!confirmed) return;
  }

  const succeeded: string[] = [];
  const failed: string[] = [];
  const spinner = p.spinner();
  for (const [index, file] of toUpload.entries()) {
    const remotePath = remotePathFor(account, file);
    if (!remotePath) {
      failed.push(file);
      continue;
    }
    spinner.start(`[${index + 1}/${toUpload.length}] Uploading ${file}`);
    const result = await runHs(["cms", "upload", join(cwd, file), remotePath], {
      accountId: account.accountId,
      cwd,
    });
    if (result.ok) {
      succeeded.push(file);
      spinner.stop(`Uploaded ${file}`);
    } else {
      failed.push(file);
      spinner.stop(`Failed ${file}`, 1);
      const detail = (result.stderr || result.stdout).trim();
      if (detail) p.log.error(detail);
    }
  }

  // Every upload failing points at the connection or the account, which is no
  // state to start deleting in.
  if (toUpload.length > 0 && succeeded.length === 0) {
    p.log.error(
      plan.remote.length > 0
        ? "All uploads failed. Nothing deleted on HubSpot, nothing committed."
        : "All uploads failed. Nothing committed."
    );
    return;
  }

  const deletion = await runDeletions(account, plan);
  const done = [...succeeded, ...deletion.deleted];
  if (done.length === 0) {
    p.log.error("Nothing was deleted on HubSpot. Nothing committed.");
    return;
  }

  await recordSyncState(account, succeeded, deletion.deleted, cwd);

  // Commit only what now holds on HubSpot, so unselected (or failed) changes stay in the tree.
  const committed = await commitScoped(cwd, done, message);
  if (committed) {
    p.log.success(`Committed: ${message}`);
  } else {
    p.log.warn("Git commit failed or nothing to commit.");
  }

  // History status tracks the HubSpot outcome only; a commit failure is
  // surfaced separately and must not mislabel a fully applied deploy.
  const problems = failed.length + deletion.failed.length;
  const status = problems === 0 ? "success" : "partial";

  try {
    const history = await loadHistory(cwd);
    await saveHistory(
      addDeploy(history, {
        timestamp: timestampNow(),
        portal: account.name,
        portal_id: account.accountId,
        message,
        status,
        file_count: succeeded.length,
        files: succeeded,
        ...(deletion.deleted.length > 0 ? { deleted_files: deletion.deleted } : {}),
      }),
      cwd
    );
  } catch (error) {
    p.log.warn(`Deploy finished, but deploy history could not be saved: ${error instanceof Error ? error.message : error}`);
  }

  const summary = [
    succeeded.length > 0 ? `${succeeded.length} file(s) uploaded` : "",
    deletion.deleted.length > 0 ? `${deletion.deleted.length} deleted` : "",
  ]
    .filter(Boolean)
    .join(", ");

  if (status === "success") {
    p.log.success(`Deploy complete: ${summary}.`);
  } else {
    p.log.warn(`Partial deploy: ${summary}, ${problems} failed${committed ? "" : ", git commit not created"}.`);
  }
}
