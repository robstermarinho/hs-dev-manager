import { describe, expect, it } from "vitest";
import { SELF_PACKAGE, SELF_VERSION, selfUpdateHint } from "../src/self-version.js";

describe("selfUpdateHint", () => {
  it("returns a hint when a newer version exists", () => {
    const hint = selfUpdateHint("1.2.0", "1.1.9");
    expect(hint).toContain("1.1.9");
    expect(hint).toContain("1.2.0");
    expect(hint).toContain(`npm install -g ${SELF_PACKAGE}@latest`);
  });

  it("returns undefined when up to date", () => {
    expect(selfUpdateHint("1.2.0", "1.2.0")).toBeUndefined();
  });

  it("returns undefined when npm somehow reports an older version", () => {
    expect(selfUpdateHint("1.0.0", "1.2.0")).toBeUndefined();
  });

  it("defaults to the bundled package version", () => {
    expect(SELF_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(selfUpdateHint(SELF_VERSION)).toBeUndefined();
  });
});
