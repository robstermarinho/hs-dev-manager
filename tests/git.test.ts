import { mkdir, mkdtemp, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { changedFiles, parsePorcelainZ } from "../src/git.js";

describe("parsePorcelainZ", () => {
  it("keeps literal spaces, unicode and arrow text", () => {
    const output = [
      "?? src/example-1/file with space.html",
      "?? src/example-1/café.html",
      "?? src/example-1/foo -> bar.html",
      "",
    ].join("\0");

    expect(parsePorcelainZ(output)).toEqual([
      "src/example-1/file with space.html",
      "src/example-1/café.html",
      "src/example-1/foo -> bar.html",
    ]);
  });

  it("returns the destination and skips the source of a rename", () => {
    expect(parsePorcelainZ("R  src/example-1/new.html\0src/example-1/old.html\0")).toEqual([
      "src/example-1/new.html",
    ]);
  });
});

describe("changedFiles", () => {
  it("reads exact unquoted paths from a real git repository", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "hsdm-git-"));
    const scope = join(cwd, "src", "example-1");
    await mkdir(scope, { recursive: true });
    await execa("git", ["init", "--quiet"], { cwd });

    for (const name of ["file with space.html", "café.html", "foo -> bar.html"]) {
      await writeFile(join(scope, name), name, "utf8");
    }

    expect((await changedFiles(cwd, "src/example-1")).sort()).toEqual(
      [
        "src/example-1/café.html",
        "src/example-1/file with space.html",
        "src/example-1/foo -> bar.html",
      ].sort()
    );

    await execa("git", ["add", "."], { cwd });
    await execa("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base", "--quiet"], {
      cwd,
    });
    await rename(join(scope, "café.html"), join(scope, "renamed café.html"));
    await execa("git", ["add", "-A"], { cwd });

    expect(await changedFiles(cwd, "src/example-1")).toContain("src/example-1/renamed café.html");
  });
});
