import { runHs } from "./runner.js";

/**
 * A remote asset with its server-side modification time.
 *
 * Two Design Manager listings are needed: `templates` covers plain files and
 * `custom-widgets` covers modules, which the templates endpoint omits entirely.
 * Both are cheap enough to run interactively, unlike downloading files to
 * compare them.
 */
export interface RemoteItem {
  /** Remote path with a leading slash, e.g. "/theme/css/main.css". */
  path: string;
  /** Server modification time, epoch milliseconds. */
  updated: number;
  kind: "file" | "module";
}

export interface V4Entry {
  path: string;
  updated: number;
}

export interface V4Page {
  entries: V4Entry[];
  /** How many objects the endpoint has in total, not just in this page. */
  total: number;
}

interface V4Object {
  path?: unknown;
  updated?: unknown;
}

/**
 * Read one page of an `hs api --json` listing. Undefined when the response is
 * not a listing at all — an empty page and a broken response must not look the
 * same, or a failed request would read as "nothing changed on HubSpot".
 */
export function parseV4Page(stdout: string): V4Page | undefined {
  let raw: { objects?: unknown; total?: unknown };
  try {
    raw = JSON.parse(stdout) as { objects?: unknown; total?: unknown };
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.objects)) return undefined;

  const entries = raw.objects
    .map((entry) => entry as V4Object)
    .filter(
      (entry): entry is V4Entry => typeof entry?.path === "string" && typeof entry?.updated === "number"
    )
    .map((entry) => ({ path: entry.path, updated: entry.updated }));

  return { entries, total: typeof raw.total === "number" ? raw.total : entries.length };
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

export const PAGE_SIZE = 1000;
/** Enough for 20k assets; a portal past that gets no answer rather than a partial one. */
export const MAX_PAGES = 20;

/**
 * Read every page of a v4 listing. Undefined when any page fails or the listing
 * turns out to be larger than we are willing to page through: a truncated
 * inventory would silently under-report drift.
 */
async function listAll(accountId: string, endpoint: string): Promise<V4Entry[] | undefined> {
  const entries: V4Entry[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const query = `${endpoint}?limit=${PAGE_SIZE}&offset=${entries.length}&property=path&property=updated`;
    const result = await runHs(["api", query, "--json"], { accountId });
    if (!result.ok) return undefined;

    const parsed = parseV4Page(result.stdout);
    if (!parsed) return undefined;

    entries.push(...parsed.entries);
    if (entries.length >= parsed.total || parsed.entries.length === 0) return entries;
  }

  return undefined;
}

/**
 * List every file and module of a portal with its remote modification time.
 * Undefined when either listing cannot be read in full (missing scopes, offline,
 * more assets than MAX_PAGES covers).
 */
export async function fetchRemoteInventory(accountId: string): Promise<RemoteItem[] | undefined> {
  const [templates, widgets] = await Promise.all([
    listAll(accountId, "/content/api/v4/templates"),
    listAll(accountId, "/content/api/v4/custom-widgets"),
  ]);

  // Half an inventory is worse than none: the missing half would look unchanged.
  if (!templates || !widgets) return undefined;

  return [
    ...templates.map((entry) => ({
      path: normalizeTemplatePath(entry.path),
      updated: entry.updated,
      kind: "file" as const,
    })),
    ...widgets.map((entry) => ({
      path: normalizeWidgetPath(entry.path),
      updated: entry.updated,
      kind: "module" as const,
    })),
  ];
}
