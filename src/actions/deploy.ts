import { existsSync } from "node:fs";
import { join } from "node:path";
import * as p from "@clack/prompts";
import type { HsAccount } from "../hs/accounts.js";
import { runHs } from "../hs/runner.js";
import { changedFiles, commitScoped, isGitRepo } from "../git.js";
import { portalScope, remotePathFor } from "../paths.js";
import { addDeploy, loadHistory, saveHistory, timestampNow } from "../state/history.js";
import { dim, handleCancel } from "../ui.js";

const IGNORE_PATTERNS = [/(^|\/)\.DS_Store$/, /\.log$/, /(^|\/)\.git(\/|$)/];

/** Files worth uploading: not ignored junk. */
export function filterDeployable(files: string[]): string[] {
  return files.filter((file) => !IGNORE_PATTERNS.some((pattern) => pattern.test(file)));
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

  const message = handleCancel(
    await p.text({
      message: "Commit message",
      initialValue: `feat(hubspot): deploy ${selected.length} file(s) to ${account.name}`,
      validate: (value) => (value?.trim() ? undefined : "Enter a message"),
    })
  );

  const confirmed = handleCancel(
    await p.confirm({ message: `Upload ${selected.length} file(s) to ${account.name} (${account.accountId})?` })
  );
  if (!confirmed) return;

  const succeeded: string[] = [];
  const failed: string[] = [];
  const spinner = p.spinner();
  for (const [index, file] of selected.entries()) {
    const remotePath = remotePathFor(account, file);
    if (!remotePath) {
      failed.push(file);
      continue;
    }
    spinner.start(`[${index + 1}/${selected.length}] Uploading ${file}`);
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

  const status = failed.length === 0 ? "success" : "partial";
  // Commit only the uploaded files so unselected (or failed) changes stay in the tree.
  const committed = await commitScoped(cwd, succeeded, message);
  if (committed) {
    p.log.success(`Committed: ${message}`);
  } else {
    p.log.warn("Git commit failed or nothing to commit.");
  }

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

  if (status === "success") {
    p.log.success(`Deploy complete: ${succeeded.length} file(s) uploaded.`);
  } else {
    p.log.warn(`Partial deploy: ${succeeded.length} uploaded, ${failed.length} failed.`);
  }
}
