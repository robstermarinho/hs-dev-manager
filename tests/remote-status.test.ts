import { describe, expect, it } from "vitest";
import type { RemoteItem } from "../src/hs/remote-inventory.js";
import { normalizeTemplatePath, normalizeWidgetPath, parseV4Page } from "../src/hs/remote-inventory.js";
import {
  CLOCK_TOLERANCE_MS,
  compareRemote,
  describePathDrift,
  describeRemoteStatus,
  driftByPath,
  driftLines,
  inventoryIndex,
  inventoryUpdatedFor,
  isRemoteCheckDisabled,
  isUnchangedSince,
  isUnder,
  REMOTE_CHECK_ENV,
} from "../src/remote-status.js";
import { recordRemoteFiles, syncedAtLookup } from "../src/state/remote-state.js";

const SYNCED = Date.parse("2026-08-05T12:00:00.000Z");

function item(path: string, updated: number, kind: RemoteItem["kind"] = "file"): RemoteItem {
  return { path, updated, kind };
}

describe("parseV4Page", () => {
  it("keeps well-formed entries and reports the listing total", () => {
    const stdout = JSON.stringify({
      total: 42,
      objects: [
        { path: "theme/main.css", updated: 1 },
        { path: "theme/no-date.css" },
        { updated: 2 },
        null,
      ],
    });
    expect(parseV4Page(stdout)).toEqual({ entries: [{ path: "theme/main.css", updated: 1 }], total: 42 });
  });

  it("falls back to the page size when the total is missing", () => {
    const stdout = JSON.stringify({ objects: [{ path: "a.css", updated: 1 }] });
    expect(parseV4Page(stdout)?.total).toBe(1);
  });

  it("is undefined for anything that is not a listing", () => {
    // Undefined, not empty: a broken response must never read as "nothing changed".
    expect(parseV4Page("not json")).toBeUndefined();
    expect(parseV4Page('{"objects":"nope"}')).toBeUndefined();
    expect(parseV4Page("<html>404</html>")).toBeUndefined();
  });

  it("reads a genuinely empty listing as empty", () => {
    expect(parseV4Page('{"total":0,"objects":[]}')).toEqual({ entries: [], total: 0 });
  });
});

describe("path normalization", () => {
  it("adds the leading slash templates omit", () => {
    expect(normalizeTemplatePath("theme/main.css")).toBe("/theme/main.css");
    expect(normalizeTemplatePath("/theme/main.css")).toBe("/theme/main.css");
  });

  it("restores the .module suffix custom-widgets drop", () => {
    expect(normalizeWidgetPath("/theme/modules/hero")).toBe("/theme/modules/hero.module");
    expect(normalizeWidgetPath("theme/modules/hero")).toBe("/theme/modules/hero.module");
    expect(normalizeWidgetPath("/theme/modules/hero.module")).toBe("/theme/modules/hero.module");
  });
});

describe("isRemoteCheckDisabled", () => {
  it("accepts the usual truthy spellings only", () => {
    for (const value of ["1", "true", "TRUE", " yes "]) {
      expect(isRemoteCheckDisabled({ [REMOTE_CHECK_ENV]: value })).toBe(true);
    }
    for (const value of ["", "0", "false", "no", "maybe"]) {
      expect(isRemoteCheckDisabled({ [REMOTE_CHECK_ENV]: value })).toBe(false);
    }
    expect(isRemoteCheckDisabled({})).toBe(false);
  });
});

describe("isUnder", () => {
  it("matches the path itself and its descendants only", () => {
    expect(isUnder("/theme", "/theme")).toBe(true);
    expect(isUnder("/theme/css/a.css", "/theme")).toBe(true);
    expect(isUnder("/theme-other/a.css", "/theme")).toBe(false);
  });
});

describe("compareRemote", () => {
  const base = {
    paths: ["/theme"],
    syncedAt: () => SYNCED,
    existsLocally: () => true,
  };

  it("flags assets modified after the last sync", () => {
    const status = compareRemote({
      ...base,
      items: [item("/theme/main.css", SYNCED + 5 * 60_000), item("/theme/other.css", SYNCED - 60_000)],
    });
    expect(status.changed.map((entry) => entry.path)).toEqual(["/theme/main.css"]);
    expect(status.added).toEqual([]);
  });

  it("absorbs clock skew within the tolerance", () => {
    const items = [item("/theme/main.css", SYNCED + CLOCK_TOLERANCE_MS - 1)];
    expect(compareRemote({ ...base, items }).changed).toEqual([]);
  });

  it("reports assets that have no local counterpart", () => {
    const status = compareRemote({
      ...base,
      existsLocally: (path) => path !== "/theme/modules/hero.module",
      items: [item("/theme/modules/hero.module", SYNCED + 600_000, "module")],
    });
    expect(status.added.map((entry) => entry.path)).toEqual(["/theme/modules/hero.module"]);
    expect(status.changed).toEqual([]);
  });

  it("stays quiet about assets it never synced", () => {
    const status = compareRemote({
      ...base,
      syncedAt: () => undefined,
      items: [item("/theme/main.css", Date.now())],
    });
    expect(status).toEqual({ changed: [], added: [] });
  });

  it("ignores anything outside the saved paths", () => {
    const status = compareRemote({
      ...base,
      items: [item("/other-theme/main.css", SYNCED + 600_000)],
    });
    expect(status).toEqual({ changed: [], added: [] });
  });
});

describe("describeRemoteStatus", () => {
  it("summarizes both kinds of drift", () => {
    expect(describeRemoteStatus({ changed: [], added: [] })).toBeUndefined();
    expect(describeRemoteStatus({ changed: [item("/a", 1), item("/b", 1)], added: [] })).toBe("2 changed on HubSpot");
    expect(describeRemoteStatus({ changed: [item("/a", 1)], added: [item("/b", 1)] })).toBe(
      "1 changed on HubSpot · 1 new"
    );
  });
});

describe("syncedAtLookup", () => {
  it("reads a file's own sync time and folds files into their containers", () => {
    const state = recordRemoteFiles(
      { files: {} },
      "example-123456",
      [
        { remotePath: "/theme/modules/hero.module/module.html", sha256: "a" },
        { remotePath: "/theme/modules/hero.module/fields.json", sha256: "b" },
      ],
      new Date(SYNCED)
    );
    const lookup = syncedAtLookup(state, "example-123456");

    expect(lookup("/theme/modules/hero.module/module.html")).toBe(SYNCED);
    // The module counts as synced because its files are.
    expect(lookup("/theme/modules/hero.module")).toBe(SYNCED);
    expect(lookup("/theme/modules")).toBe(SYNCED);
    expect(lookup("/theme/other.css")).toBeUndefined();
  });

  it("keeps the newest time under a container and ignores other portals", () => {
    let state = recordRemoteFiles({ files: {} }, "p-1", [{ remotePath: "/t/a.css", sha256: "a" }], new Date(SYNCED));
    state = recordRemoteFiles(state, "p-1", [{ remotePath: "/t/b.css", sha256: "b" }], new Date(SYNCED + 90_000));
    state = recordRemoteFiles(state, "p-2", [{ remotePath: "/t/c.css", sha256: "c" }], new Date(SYNCED + 900_000));

    const lookup = syncedAtLookup(state, "p-1");
    expect(lookup("/t")).toBe(SYNCED + 90_000);
    expect(lookup("/t/c.css")).toBeUndefined();
  });
});

describe("inventory lookups", () => {
  const index = inventoryIndex([
    item("/theme/main.css", 100),
    item("/theme/modules/hero.module", 200, "module"),
    item("/theme/main.css", 150),
  ]);

  it("keeps the newest time per path", () => {
    expect(index.get("/theme/main.css")).toBe(150);
  });

  it("finds a file directly", () => {
    expect(inventoryUpdatedFor(index, "/theme/main.css")).toBe(150);
  });

  it("answers for a file inside a module with the module's time", () => {
    expect(inventoryUpdatedFor(index, "/theme/modules/hero.module/module.html")).toBe(200);
    expect(inventoryUpdatedFor(index, "/theme/modules/hero.module/_locales/en.json")).toBe(200);
  });

  it("is undefined for anything the inventory does not cover", () => {
    expect(inventoryUpdatedFor(index, "/theme/images/logo.png")).toBeUndefined();
    // A plain folder is not a container the listing answers for.
    expect(inventoryUpdatedFor(index, "/theme/css/deep/file.css")).toBeUndefined();
  });
});

describe("isUnchangedSince", () => {
  it("needs a recorded sync to say anything", () => {
    expect(isUnchangedSince(100, undefined)).toBe(false);
  });

  it("allows the clock tolerance", () => {
    expect(isUnchangedSince(1000 + CLOCK_TOLERANCE_MS, 1000)).toBe(true);
    expect(isUnchangedSince(1000 + CLOCK_TOLERANCE_MS + 1, 1000)).toBe(false);
    expect(isUnchangedSince(500, 1000)).toBe(true);
  });
});

describe("per-path drift", () => {
  const status = {
    changed: [item("/theme/main.css", 1), item("/theme/css/a.css", 2)],
    added: [item("/other/new.css", 3), item("/theme/modules/hero.module", 4, "module")],
  };

  it("attributes each asset to its saved path", () => {
    const byPath = driftByPath(status, ["/theme", "/other"]);
    expect(byPath.get("/theme")).toEqual({ changed: 2, added: 1 });
    expect(byPath.get("/other")).toEqual({ changed: 0, added: 1 });
  });

  it("keeps paths with nothing to report in the map", () => {
    expect(driftByPath({ changed: [], added: [] }, ["/theme"]).get("/theme")).toEqual({ changed: 0, added: 0 });
  });

  it("describes a path only when it drifted", () => {
    expect(describePathDrift({ changed: 2, added: 1 })).toBe("2 changed · 1 new");
    expect(describePathDrift({ changed: 0, added: 3 })).toBe("3 new");
    expect(describePathDrift({ changed: 0, added: 0 })).toBeUndefined();
    expect(describePathDrift(undefined)).toBeUndefined();
  });
});

describe("driftLines", () => {
  it("lists newest first, labelled, without the leading slash", () => {
    expect(
      driftLines({ changed: [item("/theme/old.css", 1)], added: [item("/theme/new.css", 9)] })
    ).toEqual(["  new     theme/new.css", "  changed theme/old.css"]);
  });

  it("caps the list and says how many are hidden", () => {
    const changed = Array.from({ length: 5 }, (_, index) => item(`/theme/file-${index}.css`, index));
    const lines = driftLines({ changed, added: [] }, 2);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("  … and 3 more");
  });
});
