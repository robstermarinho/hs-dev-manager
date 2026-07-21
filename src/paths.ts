import { join } from "node:path";
import type { HsAccount } from "./hs/accounts.js";
import { portalKey } from "./hs/accounts.js";

export const LOCAL_ROOT = "src";

/** HubSpot Design Manager URL for a portal. */
export function designManagerUrl(account: HsAccount): string {
  return `https://app.hubspot.com/design-manager/${account.accountId}`;
}

/** Local directory for a remote path: ./src/{portal-name}-{id}/{remote-path} (sh-compatible layout). */
export function localDirFor(account: HsAccount, remotePath: string, cwd: string): string {
  return join(cwd, LOCAL_ROOT, portalKey(account), remotePath.replace(/^\//, ""));
}

/** Repo-relative scope of a portal's downloads, used to limit git operations. */
export function portalScope(account: HsAccount): string {
  return join(LOCAL_ROOT, portalKey(account));
}

/** Derive the remote path of a local file inside the portal dir (for uploads). */
export function remotePathFor(account: HsAccount, repoRelativeFile: string): string | undefined {
  const prefix = `${portalScope(account)}/`;
  if (!repoRelativeFile.startsWith(prefix)) return undefined;
  return `/${repoRelativeFile.slice(prefix.length)}`;
}
