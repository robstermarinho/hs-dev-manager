import { execa } from "execa";
import { runHs } from "./runner.js";

/** Minimum HubSpot CLI version we require (inclusive). Below this we block. */
export const HS_MIN_VERSION = "8.0.0";
/** Highest HubSpot CLI major we have tested against. Above this we warn but allow. */
export const HS_MAX_TESTED_MAJOR = 8;
/** npm package that provides the `hs` binary. */
export const HS_PACKAGE = "@hubspot/cli";

export type HsSupport = "not-installed" | "unknown" | "too-old" | "untested" | "ok";

export interface HsCliStatus {
  installed: boolean;
  version?: string;
  major?: number;
  /** Coarse level of support for the detected version. */
  support: HsSupport;
  /** True when the CLI is usable (blocks only on missing / too-old / unknown). */
  supported: boolean;
}

export function parseHsVersion(output: string): string | undefined {
  const match = output.trim().match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match[0] : undefined;
}

/** Compare two dotted versions. Returns -1, 0, or 1. Missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number(n) || 0);
  const pb = b.split(".").map((n) => Number(n) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export async function checkHsCli(): Promise<HsCliStatus> {
  const result = await runHs(["--version"]);
  if (!result.ok) {
    return { installed: false, support: "not-installed", supported: false };
  }
  const version = parseHsVersion(result.stdout || result.stderr);
  if (!version) {
    return { installed: true, support: "unknown", supported: false };
  }
  const major = Number(version.split(".")[0]);

  let support: HsSupport;
  if (compareVersions(version, HS_MIN_VERSION) < 0) {
    support = "too-old";
  } else if (major > HS_MAX_TESTED_MAJOR) {
    support = "untested";
  } else {
    support = "ok";
  }

  return {
    installed: true,
    version,
    major,
    support,
    supported: support === "ok" || support === "untested",
  };
}

/** Best-effort lookup of the latest published version on npm. Undefined on any failure. */
export async function latestHsVersion(): Promise<string | undefined> {
  try {
    const result = await execa("npm", ["view", HS_PACKAGE, "version"], { reject: false });
    if (result.exitCode !== 0) return undefined;
    return parseHsVersion(result.stdout);
  } catch {
    return undefined;
  }
}

/**
 * Given the installed version and the latest on npm, pick the version we should
 * upgrade to: the latest if it stays within our tested major, otherwise the
 * highest patch of our tested major. Undefined when already up to date or no
 * newer version is available.
 */
export function upgradeTarget(current: string, latest: string): string | undefined {
  if (compareVersions(latest, current) <= 0) return undefined;
  const latestMajor = Number(latest.split(".")[0]);
  if (latestMajor <= HS_MAX_TESTED_MAJOR) return latest;
  // latest is beyond what we tested — stay on our max tested major.
  return `${HS_MAX_TESTED_MAJOR}`;
}

export function hsInstallHint(status: HsCliStatus): string {
  if (!status.installed) {
    return `HubSpot CLI not found. Install it with: npm install -g ${HS_PACKAGE}`;
  }
  if (status.support === "unknown") {
    return `Could not determine HubSpot CLI version. This tool requires v${HS_MIN_VERSION}+.`;
  }
  return `HubSpot CLI ${status.version ?? "?"} is not supported. This tool requires v${HS_MIN_VERSION}+. Update with: npm install -g ${HS_PACKAGE}@latest`;
}
