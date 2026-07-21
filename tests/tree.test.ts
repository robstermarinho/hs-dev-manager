import { describe, expect, it } from "vitest";
import { renderTree } from "../src/ui.js";

describe("renderTree", () => {
  it("renders sibling paths as leaves", () => {
    expect(renderTree(["/example-theme", "/example-theme-sales-presentation"])).toBe(
      ["├─ example-theme", "└─ example-theme-sales-presentation"].join("\n")
    );
  });

  it("nests shared segments", () => {
    expect(renderTree(["/marketing/templates", "/marketing/modules/cta", "/my-theme"])).toBe(
      [
        "├─ marketing",
        "│  ├─ templates",
        "│  └─ modules",
        "│     └─ cta",
        "└─ my-theme",
      ].join("\n")
    );
  });

  it("shows a placeholder when empty", () => {
    expect(renderTree([])).toContain("No saved paths yet");
  });
});
