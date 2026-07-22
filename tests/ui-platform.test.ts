import { describe, expect, it } from "vitest";
import { browserCommand } from "../src/ui.js";

describe("browserCommand", () => {
  const url = "https://example.com/path?a=1";

  it("uses the platform browser launcher", () => {
    expect(browserCommand(url, "darwin")).toEqual({ command: "open", args: [url] });
    expect(browserCommand(url, "linux")).toEqual({ command: "xdg-open", args: [url] });
    expect(browserCommand(url, "win32")).toEqual({
      command: "cmd",
      args: ["/d", "/s", "/c", "start", "", url],
    });
  });
});
