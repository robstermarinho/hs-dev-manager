import { describe, expect, it } from "vitest";
import { lastFetch, parseFetchLog, recordFetch, timeAgo } from "../src/state/fetch-log.js";

describe("fetch log", () => {
  it("records and reads back a fetch time", () => {
    const when = new Date("2026-07-21T10:00:00Z");
    const log = recordFetch({ fetches: {} }, "example-123456", "/Example Theme", when);
    expect(lastFetch(log, "example-123456", "/Example Theme")?.toISOString()).toBe(when.toISOString());
  });

  it("returns undefined for unknown or invalid entries", () => {
    expect(lastFetch({ fetches: {} }, "x", "/y")).toBeUndefined();
    expect(lastFetch({ fetches: { "x:/y": "not-a-date" } }, "x", "/y")).toBeUndefined();
  });

  it("parses malformed json to an empty log", () => {
    expect(parseFetchLog("nope")).toEqual({ fetches: {} });
    expect(parseFetchLog('{"fetches": 5}')).toEqual({ fetches: {} });
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-07-21T12:00:00Z");
  it("formats ages", () => {
    expect(timeAgo(new Date("2026-07-21T11:59:30Z"), now)).toBe("just now");
    expect(timeAgo(new Date("2026-07-21T11:45:00Z"), now)).toBe("15m ago");
    expect(timeAgo(new Date("2026-07-21T09:00:00Z"), now)).toBe("3h ago");
    expect(timeAgo(new Date("2026-07-18T12:00:00Z"), now)).toBe("3d ago");
  });
});
