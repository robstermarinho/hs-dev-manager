import { describe, expect, it } from "vitest";
import { helpText, parseCliArgs } from "../src/cli-args.js";

describe("parseCliArgs", () => {
  it("starts the menu with no arguments", () => {
    expect(parseCliArgs([])).toEqual({ kind: "run" });
  });

  it("recognizes the version and help flags in both spellings", () => {
    for (const flag of ["--version", "-v"]) expect(parseCliArgs([flag])).toEqual({ kind: "version" });
    for (const flag of ["--help", "-h"]) expect(parseCliArgs([flag])).toEqual({ kind: "help" });
  });

  it("answers help first when both are given", () => {
    expect(parseCliArgs(["--version", "--help"])).toEqual({ kind: "help" });
  });

  it("reports an unknown flag instead of opening the menu", () => {
    expect(parseCliArgs(["--fetch"])).toEqual({ kind: "unknown", flag: "--fetch" });
  });

  it("ignores non-flag arguments", () => {
    expect(parseCliArgs(["whatever"])).toEqual({ kind: "run" });
  });
});

describe("helpText", () => {
  it("names the tool and documents the escape hatch", () => {
    const text = helpText("hs-dev-manager", "1.2.3");
    expect(text).toContain("hs-dev-manager v1.2.3");
    expect(text).toContain("hsdm --version");
    expect(text).toContain("HSDM_NO_REMOTE_CHECK=1");
  });
});
