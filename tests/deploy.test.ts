import { describe, expect, it } from "vitest";
import { filterDeployable } from "../src/actions/deploy.js";

describe("filterDeployable", () => {
  it("drops junk files, keeps real ones", () => {
    expect(
      filterDeployable([
        "src/alpha-1/theme/main.css",
        "src/alpha-1/.DS_Store",
        "src/alpha-1/nested/.DS_Store",
        "src/alpha-1/debug.log",
        ".git/config",
        "src/alpha-1/templates/page.html",
      ])
    ).toEqual(["src/alpha-1/theme/main.css", "src/alpha-1/templates/page.html"]);
  });

  it("does not over-match names containing pattern words", () => {
    expect(filterDeployable(["src/a/blog.html", "src/a/gitignore-info.md"])).toEqual([
      "src/a/blog.html",
      "src/a/gitignore-info.md",
    ]);
  });
});
