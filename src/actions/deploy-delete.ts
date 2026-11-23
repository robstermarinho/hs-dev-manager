import * as p from "@clack/prompts";
import type { HsAccount } from "../hs/accounts.js";
import { deleteRemoteFile } from "../hs/remote-delete.js";
import { remotePathFor } from "../paths.js";
import { isRemoteCheckDisabled, REMOTE_CHECK_ENV } from "../remote-status.js";
import { handleCancel, menuLabel } from "../ui.js";
import { checkRemoteDeletions, type RemoteDeletion } from "./remote-delete.js";

/** What the deploy will do about the files that were deleted locally. */
export interface DeletionPlan {
  /** Files to delete on HubSpot. */
  remote: RemoteDeletion[];
  /** Files HubSpot no longer has: nothing to delete, the local deletion is just committed. */
  gone: RemoteDeletion[];
}

export const NO_DELETIONS: DeletionPlan = { remote: [], gone: [] };

export interface DeletionOutcome {
  /** Local paths whose deletion now holds on HubSpot too. */
  deleted: string[];
  failed: string[];
}

function renderList(results: RemoteDeletion[]): string {
  return results.map((result) => `  ${result.file} — ${result.reason}`).join("\n");
}

/**
 * Ask which locally deleted files should be deleted on HubSpot as well.
 *
 * Nothing is selected up front and the final confirmation defaults to no: the
 * Design Manager has no trash, so every deletion has to be asked for twice.
 */
export async function planDeletions(account: HsAccount, deleted: string[], cwd: string): Promise<DeletionPlan> {
  const picked = handleCancel(
    await p.multiselect({
      message: `${deleted.length} file(s) deleted locally — delete on HubSpot too? (space to toggle, enter with none to keep them)`,
      options: deleted.map((file) => ({ value: file, label: file })),
      initialValues: [] as string[],
      required: false,
    })
  );
  if (picked.length === 0) {
    p.log.info("Deleted files left on HubSpot. Their local deletion stays uncommitted.");
    return NO_DELETIONS;
  }

  let remote: RemoteDeletion[];
  let gone: RemoteDeletion[] = [];

  if (isRemoteCheckDisabled()) {
    p.log.warn(
      `${REMOTE_CHECK_ENV} is set: deleting without comparing against HubSpot, so edits made there are lost silently.`
    );
    remote = picked.map((file) => ({
      file,
      remotePath: remotePathFor(account, file) ?? "",
      status: "unverified",
      reason: "remote check disabled",
    }));
  } else {
    const spinner = p.spinner();
    spinner.start("Checking HubSpot before deleting");
    const results = await checkRemoteDeletions(account, picked, cwd, {
      onProgress: (done, total, file) => spinner.message(`[${done}/${total}] Checking ${file}`),
    });
    const risky = results.filter((result) => result.status === "changed" || result.status === "unverified");
    spinner.stop(
      risky.length === 0 ? "Remote check complete — safe to delete" : `Remote check complete — ${risky.length} to review`
    );

    gone = results.filter((result) => result.status === "gone");
    remote = results.filter((result) => result.status !== "gone");
    if (gone.length > 0) {
      p.log.info(`Already gone on HubSpot — only the local deletion is committed:\n${renderList(gone)}`);
    }

    if (risky.length > 0) {
      p.log.warn(`Deleting these may lose edits made on HubSpot:\n${renderList(risky)}`);
      const choice = handleCancel(
        await p.select({
          message: "How do you want to handle them?",
          options: [
            {
              value: "skip" as const,
              label: menuLabel("remove", `Keep these on HubSpot (${risky.length})`),
              hint: "delete only the verified ones",
            },
            {
              value: "delete" as const,
              label: menuLabel("deploy", "Delete anyway"),
              hint: "HubSpot edits are lost",
            },
            { value: "cancel" as const, label: menuLabel("exit", "Delete nothing on HubSpot") },
          ],
        })
      );
      if (choice === "cancel") return { remote: [], gone };
      if (choice === "skip") remote = remote.filter((result) => result.status === "safe");
    }
  }

  // A file outside the portal directory has no remote path to delete.
  remote = remote.filter((result) => result.remotePath !== "");
  if (remote.length === 0) return { remote, gone };

  const confirmed = handleCancel(
    await p.confirm({
      message: `Permanently delete ${remote.length} file(s) from ${account.name} (${account.accountId})? This cannot be undone.`,
      initialValue: false,
    })
  );
  return { remote: confirmed ? remote : [], gone };
}

/** Run the planned deletions on HubSpot, one `hs cms delete` per file. */
export async function runDeletions(account: HsAccount, plan: DeletionPlan): Promise<DeletionOutcome> {
  const deleted = plan.gone.map((result) => result.file);
  const failed: string[] = [];
  const spinner = p.spinner();

  for (const [index, target] of plan.remote.entries()) {
    spinner.start(`[${index + 1}/${plan.remote.length}] Deleting ${target.remotePath}`);
    const result = await deleteRemoteFile(account.accountId, target.remotePath);
    if (result.ok) {
      deleted.push(target.file);
      spinner.stop(`Deleted ${target.remotePath}`);
    } else {
      failed.push(target.file);
      spinner.stop(`Failed to delete ${target.remotePath}`, 1);
      if (result.detail) p.log.error(result.detail);
    }
  }

  return { deleted, failed };
}
