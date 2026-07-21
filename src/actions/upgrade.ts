import * as p from "@clack/prompts";
import { execa } from "execa";
import {
  HS_PACKAGE,
  checkHsCli,
  latestHsVersion,
  upgradeTarget,
  type HsCliStatus,
} from "../hs/version.js";
import { dim, handleCancel } from "../ui.js";

/**
 * Compare the installed HubSpot CLI against the latest on npm and, when a newer
 * (supported) version exists, offer to install it. Runs `npm install -g` only
 * after explicit confirmation. Returns the possibly-updated CLI status.
 */
export async function offerHsUpgrade(status: HsCliStatus): Promise<HsCliStatus> {
  if (!status.installed || !status.version) return status;

  const latest = await latestHsVersion();
  if (!latest) return status; // offline or npm failure — skip silently

  const target = upgradeTarget(status.version, latest);
  if (!target) return status; // already up to date

  const spec = `${HS_PACKAGE}@${target}`;
  p.log.info(`HubSpot CLI ${dim(status.version)} installed · ${dim(latest)} available on npm`);

  const confirmed = handleCancel(
    await p.confirm({
      message: `Upgrade HubSpot CLI to ${target}? (runs npm install -g ${spec})`,
      initialValue: false,
    })
  );
  if (!confirmed) return status;

  const spinner = p.spinner();
  spinner.start(`Installing ${spec}`);
  const result = await execa("npm", ["install", "-g", spec], { reject: false });
  if (result.exitCode !== 0) {
    spinner.stop("Upgrade failed", 1);
    const detail = (result.stderr || result.stdout).trim();
    if (detail) p.log.error(detail);
    return status;
  }
  spinner.stop("HubSpot CLI upgraded");

  return checkHsCli();
}
