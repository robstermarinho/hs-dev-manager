import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  countLocalFiles,
  progressBar,
  renderFetchComplete,
  renderFetchProgress,
} from "../src/fetch-progress.js";

describe("fetch progress", () => {
  it("renders a fractional block bar", () => {
    expect(progressBar(0, 8)).toBe("[░░░░░░░░]");
    expect(progressBar(1 / 3, 8)).toBe("[██▓░░░░░]");
    expect(progressBar(1, 8)).toBe("[████████]");
  });

  it("uses the local count as an explicitly approximate baseline", () => {
    expect(renderFetchProgress(5, 10, 10)).toBe("[█████░░░░░] ~50% · 5/~10 files");
    expect(renderFetchProgress(10, 10, 10)).toBe("[█████████▒] ~95% · 10/~10 files");
    expect(renderFetchProgress(14, 10, 10)).toBe("[█████████▒] ~95% · 14/~10 files");
  });

  it("uses braille activity when no baseline exists", () => {
    expect(renderFetchProgress(0, 0)).toBe("⣀⣤⣶⣿ 0 files · total unknown");
    expect(renderFetchProgress(1, 0)).toBe("⣤⣶⣿⣶ 1 file · total unknown");
  });

  it("shows 100% only for a completed fetch", () => {
    expect(renderFetchComplete(12, 8)).toBe("[████████] 100% · 12 files");
  });

  it("counts regular local files without following symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "hsdm-progress-"));
    await mkdir(join(root, "nested"), { recursive: true });
    await mkdir(join(root, "node_modules", "package"), { recursive: true });
    await writeFile(join(root, "one.html"), "one", "utf8");
    await writeFile(join(root, "nested", "two.css"), "two", "utf8");
    await writeFile(join(root, "node_modules", "package", "index.js"), "ignored", "utf8");
    await symlink(join(root, "nested"), join(root, "linked"));

    await expect(countLocalFiles(root)).resolves.toBe(2);
    await expect(countLocalFiles(join(root, "missing"))).resolves.toBe(0);
  });
});
