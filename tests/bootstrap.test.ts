import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import {
  bootstrapProject,
  describeBootstrap,
  GITIGNORE_FILE,
  IGNORED_ENTRIES,
  missingIgnoreEntries,
  withIgnoreEntries,
} from "../src/bootstrap.js";

async function folder(): Promise<string> {
  return mkdtemp(join(tmpdir(), "hsdm-bootstrap-"));
}

describe("missingIgnoreEntries", () => {
  it("reports everything for an empty file", () => {
    expect(missingIgnoreEntries("")).toEqual([...IGNORED_ENTRIES]);
  });

  it("treats db and db/ as the same entry", () => {
    expect(missingIgnoreEntries("db\n.hsaccount\n")).toEqual([]);
    expect(missingIgnoreEntries("db/\n")).toEqual([".hsaccount"]);
  });

  it("ignores comments and blank lines", () => {
    expect(missingIgnoreEntries("# db/\n\n")).toEqual([...IGNORED_ENTRIES]);
  });
});

describe("withIgnoreEntries", () => {
  it("writes a headed section into an empty file", () => {
    expect(withIgnoreEntries("", [".hsaccount"])).toBe("# hs-dev-manager (local state)\n.hsaccount\n");
  });

  it("appends without touching what is already there", () => {
    const existing = "node_modules\ndist\n";
    const result = withIgnoreEntries(existing, ["db/"]);
    expect(result.startsWith(existing)).toBe(true);
    expect(result).toContain("db/");
  });

  it("returns the file untouched when nothing is missing", () => {
    expect(withIgnoreEntries("node_modules\n", [])).toBe("node_modules\n");
  });
});

describe("bootstrapProject", () => {
  it("creates a repository and a .gitignore", async () => {
    const cwd = await folder();

    const result = await bootstrapProject(cwd);

    expect(result.gitInitialized).toBe(true);
    expect(result.ignored).toEqual([...IGNORED_ENTRIES]);
    expect(existsSync(join(cwd, ".git"))).toBe(true);
    expect(await readFile(join(cwd, GITIGNORE_FILE), "utf8")).toContain(".hsaccount");
  });

  it("is safe to run twice", async () => {
    const cwd = await folder();
    await bootstrapProject(cwd);

    const second = await bootstrapProject(cwd);

    expect(second).toEqual({ gitInitialized: false, ignored: [], alreadyReady: true });
    expect(describeBootstrap(second)).toEqual([
      "Already set up: git repository and .gitignore are in place.",
    ]);
  });

  it("keeps an existing repository and existing ignore rules", async () => {
    const cwd = await folder();
    await execa("git", ["init", "--quiet"], { cwd });
    await writeFile(join(cwd, GITIGNORE_FILE), "node_modules\ndb/\n", "utf8");

    const result = await bootstrapProject(cwd);

    expect(result.gitInitialized).toBe(false);
    expect(result.ignored).toEqual([".hsaccount"]);
    const gitignore = await readFile(join(cwd, GITIGNORE_FILE), "utf8");
    expect(gitignore).toContain("node_modules");
    expect(gitignore.match(/db\//g)).toHaveLength(1);
  });

  it("can skip the repository, for the in-app offer that only manages ignores", async () => {
    const cwd = await folder();

    const result = await bootstrapProject(cwd, { initGit: false });

    expect(result.gitInitialized).toBe(false);
    expect(existsSync(join(cwd, ".git"))).toBe(false);
    expect(result.ignored).toEqual([...IGNORED_ENTRIES]);
  });

  it("never ignores the team's paths-config.json", async () => {
    const cwd = await folder();
    await bootstrapProject(cwd);
    expect(await readFile(join(cwd, GITIGNORE_FILE), "utf8")).not.toContain("paths-config");
  });
});
