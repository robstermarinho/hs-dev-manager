import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { execa } from "execa";

export const MAX_DIFF_LINES = 120;

/** Heuristic used by diff tools: a NUL byte in the first block means binary. */
export function isBinary(content: Uint8Array): boolean {
  return content.subarray(0, 8000).includes(0);
}

/** Drop the `diff --git` / `index` preamble git prints before the hunks. */
export function stripDiffHeader(diff: string): string {
  const lines = diff.split("\n");
  const start = lines.findIndex((line) => line.startsWith("@@"));
  return start === -1 ? diff.trim() : lines.slice(start).join("\n").trim();
}

export function truncateDiff(diff: string, maxLines: number = MAX_DIFF_LINES): string {
  const lines = diff.split("\n");
  if (lines.length <= maxLines) return diff;
  const hidden = lines.length - maxLines;
  return [...lines.slice(0, maxLines), `… ${hidden} more diff line(s)`].join("\n");
}

/**
 * Unified diff between the HubSpot copy and the local file, rendered by
 * `git diff --no-index` (git is already required by the deploy flow, so this
 * needs no diffing dependency). Undefined when the diff cannot be produced.
 */
export async function diffRemoteAgainstLocal(
  remote: Uint8Array,
  localPath: string,
  maxLines: number = MAX_DIFF_LINES
): Promise<string | undefined> {
  if (isBinary(remote)) return undefined;

  const dir = await mkdtemp(join(tmpdir(), "hsdm-diff-"));
  const remotePath = join(dir, basename(localPath));
  try {
    await writeFile(remotePath, remote);
    const result = await execa(
      "git",
      [
        "diff",
        "--no-index",
        "--no-color",
        "--src-prefix=hubspot/",
        "--dst-prefix=local/",
        "--",
        remotePath,
        localPath,
      ],
      { reject: false }
    );
    // --no-index exits 0 when the files match and 1 when they differ; anything
    // else (or an empty diff for differing files) means git could not compare them.
    if (result.exitCode !== 0 && result.exitCode !== 1) return undefined;
    const body = stripDiffHeader(result.stdout ?? "");
    return body.length > 0 ? truncateDiff(body, maxLines) : undefined;
  } catch {
    return undefined;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
