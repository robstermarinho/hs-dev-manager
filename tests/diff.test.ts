import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { diffRemoteAgainstLocal, isBinary, stripDiffHeader, truncateDiff } from "../src/diff.js";

async function localFile(content: string, name = "module.js"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hsdm-diff-test-"));
  const path = join(dir, name);
  await writeFile(path, content, "utf8");
  return path;
}

describe("isBinary", () => {
  it("detects a NUL byte", () => {
    expect(isBinary(Buffer.from([0x89, 0x50, 0x00, 0x1a]))).toBe(true);
    expect(isBinary(Buffer.from("plain text"))).toBe(false);
  });
});

describe("stripDiffHeader", () => {
  it("keeps everything from the first hunk on", () => {
    const diff = ["diff --git hubspot/a local/a", "index 111..222 100644", "--- hubspot/a", "+++ local/a", "@@ -1 +1 @@", "-old", "+new"].join("\n");
    expect(stripDiffHeader(diff)).toBe("@@ -1 +1 @@\n-old\n+new");
  });

  it("returns the input when there is no hunk header", () => {
    expect(stripDiffHeader("Binary files differ\n")).toBe("Binary files differ");
  });
});

describe("truncateDiff", () => {
  it("leaves short diffs untouched", () => {
    expect(truncateDiff("a\nb", 5)).toBe("a\nb");
  });

  it("cuts long diffs and reports the remainder", () => {
    const result = truncateDiff("a\nb\nc\nd", 2);
    expect(result).toBe("a\nb\n… 2 more diff line(s)");
  });
});

describe("diffRemoteAgainstLocal", () => {
  it("shows what the upload would overwrite", async () => {
    const path = await localFile("line one\nmy local edit\n");
    const diff = await diffRemoteAgainstLocal(Buffer.from("line one\nedited in the HubSpot UI\n"), path);

    expect(diff).toContain("@@");
    expect(diff).toContain("-edited in the HubSpot UI");
    expect(diff).toContain("+my local edit");
    expect(diff).not.toContain("diff --git");
  });

  it("is undefined when the contents match", async () => {
    const path = await localFile("same\n");
    await expect(diffRemoteAgainstLocal(Buffer.from("same\n"), path)).resolves.toBeUndefined();
  });

  it("is undefined for binary content", async () => {
    const path = await localFile("whatever", "image.png");
    await expect(diffRemoteAgainstLocal(Buffer.from([0x00, 0x01, 0x02]), path)).resolves.toBeUndefined();
  });

  it("is undefined when the local file is missing", async () => {
    await expect(diffRemoteAgainstLocal(Buffer.from("remote"), join(tmpdir(), "hsdm-missing-file.js"))).resolves
      .toBeUndefined();
  });

  it("truncates very long diffs", async () => {
    const path = await localFile(`${Array.from({ length: 400 }, (_, i) => `local ${i}`).join("\n")}\n`);
    const diff = await diffRemoteAgainstLocal(Buffer.from("remote\n"), path, 10);

    expect(diff?.split("\n")).toHaveLength(11);
    expect(diff).toContain("more diff line(s)");
  });
});
