import { describe, expect, it } from "vitest";
import { describeFetchAge, describeLocalState, pathRows } from "../src/paths-view.js";

const NOW = new Date("2026-08-12T12:00:00.000Z");

describe("describeFetchAge", () => {
  it("reads as an age when the path was fetched", () => {
    expect(describeFetchAge(new Date("2026-08-12T10:00:00.000Z"), NOW)).toBe("fetched 2h ago");
  });

  it("says so plainly when it never was", () => {
    expect(describeFetchAge(undefined, NOW)).toBe("never fetched");
  });
});

describe("describeLocalState", () => {
  it("distinguishes a path that is on disk from one that is not", () => {
    expect(describeLocalState(true)).toBe("downloaded");
    expect(describeLocalState(false)).toBe("not downloaded");
  });
});

describe("pathRows", () => {
  it("pads the path column so the details line up", () => {
    const rows = pathRows(
      [
        { path: "/kaysun", lastFetch: new Date("2026-08-12T11:00:00.000Z"), existsLocally: true },
        { path: "/a-much-longer-path", existsLocally: false },
      ],
      NOW
    );

    expect(rows[0]?.path).toBe("/kaysun".padEnd("/a-much-longer-path".length));
    expect(rows[1]?.path).toBe("/a-much-longer-path");
    expect(rows[0]?.path.length).toBe(rows[1]?.path.length);
    expect(rows[0]?.detail).toBe("fetched 1h ago · downloaded");
    expect(rows[1]?.detail).toBe("never fetched · not downloaded");
  });

  it("shortens a path too long for a row", () => {
    const long = `/${"segment/".repeat(12)}end`;
    const [row] = pathRows([{ path: long, existsLocally: true }], NOW);
    expect(row?.path.trimEnd().length).toBeLessThanOrEqual(52);
    expect(row?.path.trimEnd()).toContain("end");
  });

  it("has nothing to render without saved paths", () => {
    expect(pathRows([], NOW)).toEqual([]);
  });
});
