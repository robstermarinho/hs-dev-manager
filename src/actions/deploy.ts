import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as p from "@clack/prompts";
import type { HsAccount } from "../hs/accounts.js";
import { portalKey } from "../hs/accounts.js";
import { runHs } from "../hs/runner.js";
import { changedFiles, commitScoped, isGitRepo } from "../git.js";
import { portalScope, remotePathFor } from "../paths.js";
import { addDeploy, loadHistory, saveHistory, timestampNow } from "../state/history.js";
import { loadRemoteState, recordRemoteFiles, saveRemoteState, sha256 } from "../state/remote-state.js";
import { dim, handleCancel, menuLabel } from "../ui.js";
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

  const choice = handleCancel(
    await p.select({
      message: "How do you want to handle the remote changes?",
      options: [
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

  if (choice === "cancel") return undefined;
  if (choice === "overwrite") return files;

  const conflicted = new Set(conflicts.map((result) => result.file));
  const remaining = files.filter((file) => !conflicted.has(file));
  if (remaining.length === 0) p.log.warn("Every selected file is conflicted — nothing left to deploy.");
  return remaining;
}

/**
 * Remember what was just uploaded: the local content is now the remote content,
 * so the next deploy can tell HubSpot-side edits from our own.
 */
async function recordSyncedUploads(account: HsAccount, files: string[], cwd: string): Promise<void> {
  const entries: { remotePath: string; sha256: string }[] = [];
  for (const file of files) {
    const remotePath = remotePathFor(account, file);
    if (!remotePath) continue;
    try {
      entries.push({ remotePath, sha256: sha256(await readFile(join(cwd, file))) });
    } catch {
      // Unreadable right after a successful upload: skip, it stays unverified.
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

/** Menu action: upload changed files (git-detected) and commit them. */
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
  if (deleted.length > 0) {
    p.log.warn(
      `${deleted.length} file(s) were deleted locally and will be skipped (remove them on HubSpot with: hs cms delete):\n${deleted.map((f) => `  ${f}`).join("\n")}`
    );
  }
  if (uploadable.length === 0) return;

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

  // Ask before spending time on a commit message: the remote may have moved.
  const toUpload = await resolveRemoteConflicts(account, selected, cwd);
  if (!toUpload || toUpload.length === 0) return;

  const message = handleCancel(
    await p.text({
      message: "Commit message",
      initialValue: `feat(hubspot): deploy ${toUpload.length} file(s) to ${account.name}`,
      validate: (value) => (value?.trim() ? undefined : "Enter a message"),
    })
  );

  const confirmed = handleCancel(
    await p.confirm({ message: `Upload ${toUpload.length} file(s) to ${account.name} (${account.accountId})?` })
  );
  if (!confirmed) return;

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

  if (succeeded.length === 0) {
    p.log.error("All uploads failed. Nothing committed.");
    return;
  }

  await recordSyncedUploads(account, succeeded, cwd);

  // Commit only the uploaded files so unselected (or failed) changes stay in the tree.
  const committed = await commitScoped(cwd, succeeded, message);
  if (committed) {
    p.log.success(`Committed: ${message}`);
  } else {
    p.log.warn("Git commit failed or nothing to commit.");
  }

  // History status tracks the upload outcome only; a commit failure is
  // surfaced separately and must not mislabel a fully uploaded deploy.
  const status = failed.length === 0 ? "success" : "partial";

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
      }),
      cwd
    );
  } catch (error) {
    p.log.warn(`Upload finished, but deploy history could not be saved: ${error instanceof Error ? error.message : error}`);
  }

  if (status === "success") {
    p.log.success(`Deploy complete: ${succeeded.length} file(s) uploaded.`);
  } else {
    p.log.warn(
      `Partial deploy: ${succeeded.length} uploaded, ${failed.length} failed${committed ? "" : ", git commit not created"}.`
    );
  }
}
