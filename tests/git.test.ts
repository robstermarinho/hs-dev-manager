import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { changedFiles, diffScope, markIntentToAdd, parsePorcelainZ, restoreScope, unstageScope } from "../src/git.js";

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

async function repoWithFetchedChanges(): Promise<{ cwd: string; scope: string; tracked: string; added: string }> {
  const cwd = await mkdtemp(join(tmpdir(), "hsdm-git-scope-"));
  const scope = "src/example-1";
  const tracked = join(cwd, scope, "main.css");
  const added = join(cwd, scope, "new.css");
  const outside = join(cwd, "other.css");

  await mkdir(join(cwd, scope), { recursive: true });
  await writeFile(tracked, "committed\n", "utf8");
  await writeFile(outside, "untouched\n", "utf8");
  await execa("git", ["init", "--quiet"], { cwd });
  await execa("git", ["add", "."], { cwd });
  await execa("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base", "--quiet"], {
    cwd,
  });

  await writeFile(tracked, "from hubspot\n", "utf8");
  await writeFile(added, "new from hubspot\n", "utf8");
  await writeFile(outside, "local work\n", "utf8");
  return { cwd, scope, tracked, added };
}

describe("scope diff helpers", () => {
  it("includes newly created files in the diff once marked intent-to-add", async () => {
    const { cwd, scope } = await repoWithFetchedChanges();

    expect(await diffScope(cwd, scope)).not.toContain("new.css");

    expect(await markIntentToAdd(cwd, scope)).toBe(true);
    const diff = await diffScope(cwd, scope);
    expect(diff).toContain("+new from hubspot");
    expect(diff).toContain("-committed");
    expect(diff).not.toContain("other.css");

    expect(await diffScope(cwd, scope, "stat")).toContain("2 files changed");
  });

  it("unstages a scope without touching the working tree", async () => {
    const { cwd, scope, added } = await repoWithFetchedChanges();
    await markIntentToAdd(cwd, scope);

    expect(await unstageScope(cwd, scope)).toBe(true);
    expect((await execa("git", ["diff", "--cached", "--name-only"], { cwd })).stdout).toBe("");
    expect(existsSync(added)).toBe(true);
  });
});

describe("restoreScope", () => {
  it("restores tracked files, deletes new ones and leaves other scopes alone", async () => {
    const { cwd, scope, tracked, added } = await repoWithFetchedChanges();
    await markIntentToAdd(cwd, scope);

    expect(await restoreScope(cwd, scope)).toBe(true);
    expect(await readFile(tracked, "utf8")).toBe("committed\n");
    expect(existsSync(added)).toBe(false);
    expect(await changedFiles(cwd, scope)).toEqual([]);
    // Work outside the portal scope must survive the undo.
    expect(await readFile(join(cwd, "other.css"), "utf8")).toBe("local work\n");
  });
});
