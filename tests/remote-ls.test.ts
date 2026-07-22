import { describe, expect, it } from "vitest";
import { classifyEntry, joinRemote, parentRemote, parseLsOutput } from "../src/hs/remote-ls.js";

describe("classifyEntry", () => {
  it("classifies modules, files and folders", () => {
    expect(classifyEntry("custom-divider.module")).toBe("module");
    expect(classifyEntry("theme.json")).toBe("file");
    expect(classifyEntry("child.css")).toBe("file");
    expect(classifyEntry("modules")).toBe("folder");
    expect(classifyEntry("example-theme")).toBe("folder");
  });
});

describe("parseLsOutput", () => {
  it("parses names, classifies and sorts folders → modules → files", () => {
    const out = ["theme.json", "modules", "hero.module", "css", ""].join("\n");
    expect(parseLsOutput(out)).toEqual([
      { name: "css", kind: "folder" },
      { name: "modules", kind: "folder" },
      { name: "hero.module", kind: "module" },
      { name: "theme.json", kind: "file" },
    ]);
  });

  it("returns empty for empty output", () => {
    expect(parseLsOutput("\n\n")).toEqual([]);
  });
});

describe("remote path helpers", () => {
  it("joins from root and nested", () => {
    expect(joinRemote("/", "example-theme")).toBe("/example-theme");
    expect(joinRemote("/example-theme", "modules")).toBe("/example-theme/modules");
  });

  it("computes parents", () => {
    expect(parentRemote("/example-theme/modules")).toBe("/example-theme");
    expect(parentRemote("/example-theme")).toBe("/");
    expect(parentRemote("/")).toBe("/");
  });
});
