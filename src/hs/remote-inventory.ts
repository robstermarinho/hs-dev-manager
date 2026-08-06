import { runHs } from "./runner.js";

/**
 * A remote asset with its server-side modification time.
 *
 * Two Design Manager listings are needed: `templates` covers plain files and
 * `custom-widgets` covers modules, which the templates endpoint omits entirely.
 * Both are one request each, so a whole portal costs two calls — cheap enough to
 * run in the background, unlike downloading files to compare them.
 */
export interface RemoteItem {
  /** Remote path with a leading slash, e.g. "/theme/css/main.css". */
  path: string;
  /** Server modification time, epoch milliseconds. */
  updated: number;
  kind: "file" | "module";
}

interface V4Object {
  path?: unknown;
  updated?: unknown;
}

/** Read `{ objects: [{ path, updated }] }` from an `hs api --json` response. */
export function parseV4Objects(stdout: string): { path: string; updated: number }[] {
  try {
    const raw = JSON.parse(stdout) as { objects?: unknown };
    if (!Array.isArray(raw?.objects)) return [];
    return raw.objects
      .map((entry) => entry as V4Object)
      .filter(
        (entry): entry is { path: string; updated: number } =>
          typeof entry?.path === "string" && typeof entry?.updated === "number"
      )
      .map((entry) => ({ path: entry.path, updated: entry.updated }));
  } catch {
    return [];
  }
}

/** Templates come back without a leading slash: "theme/main.css" → "/theme/main.css". */
export function normalizeTemplatePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

/** Modules come back as "/theme/modules/hero" → "/theme/modules/hero.module". */
export function normalizeWidgetPath(path: string): string {
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  return withSlash.endsWith(".module") ? withSlash : `${withSlash}.module`;
}

const LIMIT = 1000;

/**
 * List every file and module of a portal with its remote modification time.
 * Undefined when the file listing fails (missing scopes, offline, aborted).
 */
export async function fetchRemoteInventory(accountId: string): Promise<RemoteItem[] | undefined> {
  const [templates, widgets] = await Promise.all([
    runHs(
      ["api", `/content/api/v4/templates?limit=${LIMIT}&property=path&property=updated`, "--json"],
      { accountId }
    ),
    runHs(
      ["api", `/content/api/v4/custom-widgets?limit=${LIMIT}&property=path&property=updated`, "--json"],
      { accountId }
    ),
  ]);

  if (!templates.ok) return undefined;

  const items: RemoteItem[] = parseV4Objects(templates.stdout).map((entry) => ({
    path: normalizeTemplatePath(entry.path),
    updated: entry.updated,
    kind: "file" as const,
  }));

  // Modules are a bonus: without them the check still reports file changes.
  if (widgets.ok) {
    for (const entry of parseV4Objects(widgets.stdout)) {
      items.push({ path: normalizeWidgetPath(entry.path), updated: entry.updated, kind: "module" });
    }
  }

  return items;
}
