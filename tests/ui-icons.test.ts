import { describe, expect, it } from "vitest";
import { stripAnsi } from "../src/hs/watch-parser.js";
import { menuIcon, menuLabel } from "../src/ui.js";

describe("menu icons", () => {
  it("uses compact symbolic prefixes instead of emoji", () => {
    expect(menuIcon).toMatchObject({
      add: "+",
      remove: "−",
      fetch: "↓",
      watch: "~",
      deploy: "↑",
      history: "↺",
      help: "?",
      back: "←",
      exit: "×",
    });
  });

  it("keeps the label readable without relying on color", () => {
    expect(stripAnsi(menuLabel("back", "Back"))).toBe("← Back");
    expect(stripAnsi(menuLabel("deploy", "Deploy"))).toBe("↑ Deploy");
  });
});
