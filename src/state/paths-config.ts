import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const PATHS_CONFIG_FILE = "paths-config.json";

/** Same schema as the sh version, so existing paths-config.json files keep working. */
export interface PathsConfig {
  portals: Record<string, { paths: string[] }>;
}

const EMPTY: PathsConfig = { portals: {} };

/** Normalize a Design Manager remote path: leading slash, no trailing slash. */
export function normalizeRemotePath(input: string | undefined | null): string {
  let path = (input ?? "").trim();
  if (!path) return "";
  if (!path.startsWith("/")) path = `/${path}`;
  while (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

export function parsePathsConfig(text: string): PathsConfig {
  try {
    const raw = JSON.parse(text) as unknown;
    if (!raw || typeof raw !== "object" || typeof (raw as PathsConfig).portals !== "object") {
      return structuredClone(EMPTY);
    }
    const portals: PathsConfig["portals"] = {};
    for (const [key, value] of Object.entries((raw as PathsConfig).portals ?? {})) {
      const paths = Array.isArray(value?.paths) ? value.paths.filter((p) => typeof p === "string") : [];
      portals[key] = { paths };
    }
    return { portals };
  } catch {
    return structuredClone(EMPTY);
  }
}

export function addPath(config: PathsConfig, portalKey: string, remotePath: string): PathsConfig {
  const normalized = normalizeRemotePath(remotePath);
  const existing = config.portals[portalKey]?.paths ?? [];
  if (existing.includes(normalized)) return config;
  return {
    portals: {
      ...config.portals,
      [portalKey]: { paths: [...existing, normalized] },
    },
  };
}

export function removePath(config: PathsConfig, portalKey: string, remotePath: string): PathsConfig {
  const existing = config.portals[portalKey]?.paths ?? [];
  return {
    portals: {
      ...config.portals,
      [portalKey]: { paths: existing.filter((p) => p !== remotePath) },
    },
  };
}

export function portalPaths(config: PathsConfig, portalKey: string): string[] {
  return config.portals[portalKey]?.paths ?? [];
}

export async function loadPathsConfig(cwd: string = process.cwd()): Promise<PathsConfig> {
  try {
    return parsePathsConfig(await readFile(join(cwd, PATHS_CONFIG_FILE), "utf8"));
  } catch {
    return structuredClone(EMPTY);
  }
}

export async function savePathsConfig(config: PathsConfig, cwd: string = process.cwd()): Promise<void> {
  await writeFile(join(cwd, PATHS_CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
