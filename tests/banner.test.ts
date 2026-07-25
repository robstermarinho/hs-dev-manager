import { describe, expect, it } from "vitest";
import { renderBanner } from "../src/banner.js";
import { stripAnsi } from "../src/hs/watch-parser.js";

describe("CLI banner", () => {
  it("renders the prompt icon and full product name in a compact three-line wordmark", () => {
    const banner = renderBanner(false);
    const lines = banner.split("\n");

    expect(lines).toHaveLength(3);
    expect(banner).toMatch(/[▀▄█]/);
    expect(lines[2]).toContain("▀▀ ▄▄▄▄");
    expect(lines.every((line) => line.length <= 100)).toBe(true);
  });

  it("uses HubSpot orange and a blue gradient without changing the readable output", () => {
    const colored = renderBanner(true);

    expect(colored).toContain("[38;2;255;122;89m");
    expect(colored).toContain("[38;2;91;225;255m");
    expect(colored).toContain("[38;2;70;91;235m");
    expect(stripAnsi(colored)).toBe(renderBanner(false).trim());
  });
});
