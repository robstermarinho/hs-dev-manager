import { runHs } from "./runner.js";

export const MIN_HS_MAJOR = 8;

export interface HsCliStatus {
  installed: boolean;
  version?: string;
  major?: number;
  supported: boolean;
}

export function parseHsVersion(output: string): string | undefined {
  const match = output.trim().match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match[0] : undefined;
}

export async function checkHsCli(): Promise<HsCliStatus> {
  const result = await runHs(["--version"]);
  if (!result.ok) {
    return { installed: false, supported: false };
  }
  const version = parseHsVersion(result.stdout || result.stderr);
  if (!version) {
    return { installed: true, supported: false };
  }
  const major = Number(version.split(".")[0]);
  return { installed: true, version, major, supported: major >= MIN_HS_MAJOR };
}

export function hsInstallHint(status: HsCliStatus): string {
  if (!status.installed) {
    return "HubSpot CLI não encontrado. Instale com: npm install -g @hubspot/cli";
  }
  return `HubSpot CLI ${status.version ?? "?"} não suportado. Este tool requer v${MIN_HS_MAJOR}+. Atualize com: npm install -g @hubspot/cli@latest`;
}
