import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { runHs } from "./runner.js";

export interface HsAccount {
  name: string;
  accountId: string;
  isDefault: boolean;
}

export interface AccountsResult {
  accounts: HsAccount[];
  source: string;
}

export const GLOBAL_CONFIG_PATH = join(homedir(), ".hscli", "config.yml");
const LEGACY_CONFIG_FILES = ["hubspot.config.yml", "archived.hubspot.config.yml"];

interface RawAccountEntry {
  name?: unknown;
  accountId?: unknown;
  portalId?: unknown;
}

interface RawConfig {
  defaultAccount?: unknown;
  defaultPortal?: unknown;
  accounts?: RawAccountEntry[];
  portals?: RawAccountEntry[];
}

/** Parse ~/.hscli/config.yml (v8 global) or legacy hubspot.config.yml content. */
export function parseConfigYaml(yamlText: string): HsAccount[] {
  const raw = yaml.load(yamlText) as RawConfig | null | undefined;
  if (!raw || typeof raw !== "object") return [];

  const entries = raw.accounts ?? raw.portals ?? [];
  if (!Array.isArray(entries)) return [];

  const defaultId = String(raw.defaultAccount ?? raw.defaultPortal ?? "");
  const accounts: HsAccount[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const id = entry.accountId ?? entry.portalId;
    if (id === undefined || id === null || entry.name === undefined) continue;
    accounts.push({
      name: String(entry.name),
      accountId: String(id),
      isDefault: String(id) === defaultId,
    });
  }
  return accounts;
}

/**
 * Parse the table printed by `hs account list`, e.g.:
 *   Name                Account ID    Auth Type
 *   example-site [standard]   123456   personalaccesskey
 */
export function parseAccountListOutput(output: string): HsAccount[] {
  const accounts: HsAccount[] = [];
  let defaultId = "";

  const defaultMatch = output.match(/Default Account[\s\S]*?\((\d+)\)/);
  if (defaultMatch?.[1]) defaultId = defaultMatch[1];

  for (const line of output.split("\n")) {
    const match = line.match(/^\s{2,}(.+?)\s{2,}(\d+)\s{2,}\S+\s*$/);
    if (!match || match[1] === undefined || match[2] === undefined) continue;
    const name = match[1].replace(/\s*\[[^\]]+\]\s*$/, "").trim();
    if (name === "Name") continue;
    accounts.push({ name, accountId: match[2], isDefault: match[2] === defaultId });
  }
  return accounts;
}

async function readConfigFile(path: string): Promise<HsAccount[] | undefined> {
  try {
    const text = await readFile(path, "utf8");
    const accounts = parseConfigYaml(text);
    return accounts.length > 0 ? accounts : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Discover accounts: global v8 config first, then legacy project configs,
 * then `hs account list` output as last resort.
 */
export async function discoverAccounts(cwd: string = process.cwd()): Promise<AccountsResult | undefined> {
  const global = await readConfigFile(GLOBAL_CONFIG_PATH);
  if (global) return { accounts: global, source: GLOBAL_CONFIG_PATH };

  for (const file of LEGACY_CONFIG_FILES) {
    const path = join(cwd, file);
    const legacy = await readConfigFile(path);
    if (legacy) return { accounts: legacy, source: path };
  }

  const result = await runHs(["account", "list"]);
  if (result.ok) {
    const parsed = parseAccountListOutput(result.stdout);
    if (parsed.length > 0) return { accounts: parsed, source: "hs account list" };
  }
  return undefined;
}

/** Key used by paths-config.json to namespace a portal (same scheme as the sh version). */
export function portalKey(account: HsAccount): string {
  return `${account.name}-${account.accountId}`;
}
