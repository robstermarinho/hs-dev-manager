import { runHs } from "./runner.js";
import { stripAnsi } from "./watch-parser.js";

export interface RemoteDeleteResult {
  ok: boolean;
  /** What `hs` printed, for the error report. */
  detail: string;
}

/**
 * Whether `hs cms delete` output confirms the deletion.
 *
 * The command catches its own API errors and still exits 0, so the exit code
 * says nothing: only the `Deleted "<path>" from account ...` line proves it.
 */
export function deleteSucceeded(output: string): boolean {
  return output.split("\n").some((line) => /^Deleted ".+" from account\b/.test(stripAnsi(line)));
}

/** Delete one file from the Design Manager. Permanent: HubSpot keeps no trash for it. */
export async function deleteRemoteFile(accountId: string, remotePath: string): Promise<RemoteDeleteResult> {
  const result = await runHs(["cms", "delete", remotePath], { accountId });
  const output = `${result.stdout}\n${result.stderr}`;
  return {
    ok: result.ok && deleteSucceeded(output),
    detail: stripAnsi(result.stderr || result.stdout),
  };
}
