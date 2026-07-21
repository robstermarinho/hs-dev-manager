import * as p from "@clack/prompts";
import { discoverAccounts, type AccountsResult } from "../hs/accounts.js";
import { spawnHs } from "../hs/runner.js";
import { dim } from "../ui.js";

/**
 * Menu action: authenticate a new HubSpot portal by delegating to the interactive
 * `hs account auth` flow, then re-discover accounts. Returns the refreshed result,
 * or undefined if discovery still finds nothing.
 */
export async function addPortalAction(): Promise<AccountsResult | undefined> {
  p.log.info(dim("Launching HubSpot CLI authentication (hs account auth)…"));

  const result = await spawnHs(["account", "auth"]);
  if (!result || result.exitCode !== 0) {
    p.log.warn("Authentication did not complete. No portal added.");
    return undefined;
  }

  const discovered = await discoverAccounts();
  if (!discovered || discovered.accounts.length === 0) {
    p.log.warn("Authenticated, but no accounts were discovered.");
    return undefined;
  }

  p.log.success(`Now managing ${discovered.accounts.length} portal(s).`);
  return discovered;
}
