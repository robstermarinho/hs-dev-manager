import { describe, expect, it } from "vitest";
import {
  HS_MAX_TESTED_MAJOR,
  compareVersions,
  parseHsVersion,
  upgradeTarget,
} from "../src/hs/version.js";

describe("parseHsVersion", () => {
  it("extracts a semver from noisy output", () => {
    expect(parseHsVersion("8.4.0")).toBe("8.4.0");
    expect(parseHsVersion("hs version 8.4.0 (node 20)")).toBe("8.4.0");
  });

  it("returns undefined when no version present", () => {
    expect(parseHsVersion("no version here")).toBeUndefined();
  });
});

describe("compareVersions", () => {
  it("orders by major, minor, patch", () => {
    expect(compareVersions("8.0.0", "8.0.0")).toBe(0);
    expect(compareVersions("8.1.0", "8.0.9")).toBe(1);
    expect(compareVersions("7.9.9", "8.0.0")).toBe(-1);
    expect(compareVersions("9.0.0", "8.4.0")).toBe(1);
  });

  it("treats missing parts as zero", () => {
    expect(compareVersions("8", "8.0.0")).toBe(0);
    expect(compareVersions("8.1", "8.0.9")).toBe(1);
  });
});

describe("upgradeTarget", () => {
  it("returns undefined when already up to date", () => {
    expect(upgradeTarget("8.4.0", "8.4.0")).toBeUndefined();
    expect(upgradeTarget("8.4.0", "8.3.0")).toBeUndefined();
  });

  it("targets the latest when within tested major", () => {
    expect(upgradeTarget("8.2.0", "8.4.0")).toBe("8.4.0");
  });

  it("pins to tested major when latest is beyond it", () => {
    expect(upgradeTarget("8.4.0", "9.1.0")).toBe(String(HS_MAX_TESTED_MAJOR));
  });
});
