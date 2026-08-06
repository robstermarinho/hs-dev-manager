import { describe, expect, it } from "vitest";
import { parseWatchLine, stripAnsi } from "../src/hs/watch-parser.js";
import { applyEvent, createWatchStats, stripRoot, summaryLines } from "../src/actions/watch-monitor.js";

describe("parseWatchLine", () => {
  it("parses the ready line", () => {
    const e = parseWatchLine(
      "Watcher is ready and watching /repo/src/example-123456/example-theme. Any changes detected will be automatically uploaded"
    );
    expect(e).toEqual({ type: "ready", dir: "/repo/src/example-123456/example-theme" });
  });

  it("parses an uploaded line", () => {
    const e = parseWatchLine(
      "Uploaded file /repo/src/example-123456/example-theme/modules/hero.module/module.html to /example-theme/modules/hero.module/module.html"
    );
    expect(e).toEqual({
      type: "uploaded",
      localPath: "/repo/src/example-123456/example-theme/modules/hero.module/module.html",
      remotePath: "/example-theme/modules/hero.module/module.html",
    });
  });

  it("parses a preview url", () => {
    const e = parseWatchLine("To preview this theme, visit: https://app.hubspot.com/theme-previewer/123456/edit/example-theme");
    expect(e).toEqual({ type: "preview", url: "https://app.hubspot.com/theme-previewer/123456/edit/example-theme" });
  });

  it("flags error lines", () => {
    expect(parseWatchLine("Error: upload failed for module.html")).toEqual({
      type: "error",
      message: "Error: upload failed for module.html",
    });
  });

  it("passes unrecognized lines through as raw and drops empties", () => {
    expect(parseWatchLine("")).toBeUndefined();
    expect(parseWatchLine("Some unrelated log")).toEqual({ type: "raw", message: "Some unrelated log" });
  });

  it("strips ANSI before matching", () => {
    const e = parseWatchLine("\x1b[32mUploaded file /a/b.html to /b.html\x1b[0m");
    expect(e).toMatchObject({ type: "uploaded", remotePath: "/b.html" });
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
  });
});

describe("stripRoot", () => {
  it("strips the watched root prefix", () => {
    expect(stripRoot("/example-theme/modules/hero.module/module.html", "/example-theme")).toBe(
      "modules/hero.module/module.html"
    );
  });

  it("returns the path without leading slash when no root matches", () => {
    expect(stripRoot("/other/x.html", "/example-theme")).toBe("other/x.html");
  });
});

describe("watch stats", () => {
  it("counts uploads and unique files", () => {
    const stats = createWatchStats();
    applyEvent(stats, { type: "uploaded", localPath: "a", remotePath: "/t/a.html" });
    applyEvent(stats, { type: "uploaded", localPath: "a", remotePath: "/t/a.html" });
    applyEvent(stats, { type: "uploaded", localPath: "b", remotePath: "/t/b.html" });
    expect(stats.uploaded).toBe(3);
    expect(stats.files.size).toBe(2);
  });

  it("tracks errors and preview, and summarizes", () => {
    const stats = createWatchStats();
    applyEvent(stats, { type: "uploaded", localPath: "a", remotePath: "/t/a.html" });
    applyEvent(stats, { type: "error", message: "boom" });
    applyEvent(stats, { type: "preview", url: "https://x" });
    expect(stats.errors).toBe(1);
    const summary = summaryLines(stats).join("\n");
    expect(summary).toContain("1 uploaded");
    expect(summary).toContain("1 error");
    expect(summary).toContain("https://x");
  });
});
