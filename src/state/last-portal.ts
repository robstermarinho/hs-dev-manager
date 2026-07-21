import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HsAccount } from "../hs/accounts.js";

/** Same file the sh version used to remember the active portal (account id only). */
export const LAST_PORTAL_FILE = ".hsaccount";

export async function loadLastPortalId(cwd: string = process.cwd()): Promise<string | undefined> {
  try {
    const id = (await readFile(join(cwd, LAST_PORTAL_FILE), "utf8")).trim();
    return /^\d+$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

export async function saveLastPortalId(account: HsAccount, cwd: string = process.cwd()): Promise<void> {
  try {
    await writeFile(join(cwd, LAST_PORTAL_FILE), `${account.accountId}\n`, "utf8");
  } catch {
    // best-effort: losing the last-portal memory is not worth failing an action
  }
}
