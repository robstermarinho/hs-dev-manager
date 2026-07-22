import { execa } from "execa";
import pkg from "../package.json" with { type: "json" };
import { compareVersions, parseHsVersion } from "./hs/version.js";

/** This tool's npm package name and the version compiled into the bundle. */
export const SELF_PACKAGE = pkg.name;
export const SELF_VERSION = pkg.version;

/** Best-effort lookup of the latest published version of this tool on npm. Undefined on any failure. */
export async function latestSelfVersion(): Promise<string | undefined> {
  try {
    const result = await execa("npm", ["view", SELF_PACKAGE, "version"], { reject: false });
    if (result.exitCode !== 0) return undefined;
    return parseHsVersion(result.stdout);
  } catch {
    return undefined;
  }
}

/**
 * Warning line when `latest` is newer than the running version, otherwise
 * undefined (up to date, or npm lookup failed upstream).
 */
export function selfUpdateHint(latest: string, current: string = SELF_VERSION): string | undefined {
  if (compareVersions(latest, current) <= 0) return undefined;
  return `${SELF_PACKAGE} v${current} is outdated — v${latest} available. Update with: npm install -g ${SELF_PACKAGE}@latest`;
}
