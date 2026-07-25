import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import type { HsAccount } from "./hs/accounts.js";
import { portalKey } from "./hs/accounts.js";

export const LOCAL_ROOT = "src";

function portalDirectoryName(account: HsAccount): string {
  const key = portalKey(account);
  if (!key || key.includes("\0") || key.includes("/") || key.includes("\\") || key === "." || key === "..") {
    throw new Error(`Unsafe HubSpot account name for a local directory: ${account.name}`);
  }
  return key;
}

function isOutside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot);
}

/** HubSpot Design Manager URL for a portal. */
export function designManagerUrl(account: HsAccount): string {
  return `https://app.hubspot.com/design-manager/${account.accountId}`;
}

/** Direct HubSpot app URLs scoped to a portal. */
export function hubspotPortalUrls(account: HsAccount): {
  designManager: string;
  websites: string;
  hubdb: string;
  settings: string;
  files: string;
} {
  const portalId = account.accountId;
  return {
    designManager: designManagerUrl(account),
    websites: `https://app.hubspot.com/website/${portalId}/pages/site`,
    hubdb: `https://app.hubspot.com/hubdb/${portalId}`,
    settings: `https://app.hubspot.com/settings/${portalId}`,
    files: `https://app.hubspot.com/files/${portalId}`,
  };
}

/** Local directory for a remote path: ./src/{portal-name}-{id}/{remote-path} (sh-compatible layout). */
export function localDirFor(account: HsAccount, remotePath: string, cwd: string): string {
  const portalRoot = resolve(cwd, LOCAL_ROOT, portalDirectoryName(account));
  const destination = resolve(portalRoot, remotePath.replace(/^[\\/]+/, ""));
  if (isOutside(portalRoot, destination)) {
    throw new Error(`Remote path escapes the portal directory: ${remotePath}`);
  }
  return destination;
}

/** Repo-relative scope of a portal's downloads, used to limit git operations. */
export function portalScope(account: HsAccount): string {
  return posix.join(LOCAL_ROOT, portalDirectoryName(account));
}

/** Derive the remote path of a local file inside the portal dir (for uploads). */
export function remotePathFor(account: HsAccount, repoRelativeFile: string): string | undefined {
  const prefix = `${portalScope(account)}/`;
  const normalizedFile = repoRelativeFile.replaceAll("\\", "/");
  if (!normalizedFile.startsWith(prefix)) return undefined;
  return `/${normalizedFile.slice(prefix.length)}`;
}
