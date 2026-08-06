import { describe, expect, it } from "vitest";
import {
  alignRows,
  deployAge,
  deployRow,
  fileCountLabel,
  parseDeployTimestamp,
  scopeRelative,
  summarizeFiles,
} from "../src/history-view.js";
import { shortenPath } from "../src/ui.js";
import type { DeployRecord } from "../src/state/history.js";

const SCOPE = "src/example-123456";

function record(overrides: Partial<DeployRecord> = {}): DeployRecord {
  return {
    timestamp: "2026-08-05 17:01:40",
    portal: "example",
    portal_id: "123456",
    message: "feat(hubspot): deploy 1 file(s) to example",
    status: "success",
    file_count: 1,
    files: [`${SCOPE}/theme/modules/hero.module/module.html`],
    ...overrides,
  };
}

describe("parseDeployTimestamp", () => {
  it("reads the stored local format", () => {
    expect(parseDeployTimestamp("2026-08-05 17:01:40")?.getFullYear()).toBe(2026);
    expect(parseDeployTimestamp("2026-08-05 17:01:40")?.getMonth()).toBe(7);
    expect(parseDeployTimestamp("2026-08-05 17:01:40")?.getHours()).toBe(17);
  });

  it("is undefined for anything else", () => {
    expect(parseDeployTimestamp("yesterday")).toBeUndefined();
    expect(parseDeployTimestamp("")).toBeUndefined();
  });
});

describe("deployAge", () => {
  it("renders a relative age", () => {
    expect(deployAge("2026-08-05 12:00:00", new Date(2026, 7, 5, 14, 30, 0))).toBe("2h ago");
  });

  it("falls back to the raw value when unparseable", () => {
    expect(deployAge("whenever", new Date())).toBe("whenever");
  });
});

describe("scopeRelative", () => {
  it("drops the portal scope prefix and leaves other paths alone", () => {
    expect(scopeRelative(`${SCOPE}/theme/main.css`, SCOPE)).toBe("theme/main.css");
    expect(scopeRelative("other/file.css", SCOPE)).toBe("other/file.css");
  });
});

describe("shortenPath", () => {
  it("keeps short paths intact", () => {
    expect(shortenPath("theme/main.css", 52)).toBe("theme/main.css");
  });

  it("drops leading segments until it fits", () => {
    // Keeps the longest tail that fits the budget.
    expect(shortenPath("a/very/deep/tree/of/folders/module.html", 30)).toBe("…/tree/of/folders/module.html");
    // "…/folders/module.html" is 21 chars, so a 20-char budget drops one more segment.
    expect(shortenPath("a/very/deep/tree/of/folders/module.html", 20)).toBe("…/module.html");
  });

  it("truncates the file name when it alone is too long", () => {
    const result = shortenPath("dir/aaaaaaaaaaaaaaaaaaaaaaaaaaaa.png", 10);
    expect(result.startsWith("…")).toBe(true);
    expect(result).toHaveLength(10);
  });
});

describe("summarizeFiles", () => {
  it("shows the first file and how many more there are", () => {
    expect(summarizeFiles([`${SCOPE}/a.html`, `${SCOPE}/b.html`, `${SCOPE}/c.html`], SCOPE)).toBe("a.html +2 more");
    expect(summarizeFiles([`${SCOPE}/a.html`], SCOPE)).toBe("a.html");
    expect(summarizeFiles([], SCOPE)).toBe("no files");
  });
});

describe("fileCountLabel", () => {
  it("pluralizes", () => {
    expect(fileCountLabel(1)).toBe("1 file");
    expect(fileCountLabel(6)).toBe("6 files");
  });
});

describe("deployRow and alignRows", () => {
  it("builds a row per deploy", () => {
    const row = deployRow(record(), SCOPE, new Date(2026, 7, 5, 19, 1, 40));
    expect(row).toEqual({
      age: "2h ago",
      files: "1 file",
      summary: "theme/modules/hero.module/module.html",
      ok: true,
    });
    expect(deployRow(record({ status: "partial" }), SCOPE).ok).toBe(false);
  });

  it("pads the age and count columns to a common width", () => {
    const rows = alignRows([
      { age: "2h ago", files: "1 file", summary: "a", ok: true },
      { age: "44d ago", files: "12 files", summary: "b", ok: true },
    ]);
    expect(rows[0]).toEqual({ age: "2h ago ", files: "1 file  ", summary: "a" });
    expect(rows[1]).toEqual({ age: "44d ago", files: "12 files", summary: "b" });
  });

  it("handles an empty list", () => {
    expect(alignRows([])).toEqual([]);
  });
});
