import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHs } from "./runner.js";

/** Basename of a remote (posix) path. */
export function remoteBasename(remotePath: string): string {
  const parts = remotePath.split("/").filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? "";
}

/**
 * Download a single remote file into a throwaway temp dir and return its bytes.
 * `hs cms fetch <src> <dest>` writes `<dest>/<basename>` for file sources.
 * Undefined when the download fails (missing file, auth error, network).
 */
export async function readRemoteFile(accountId: string, remotePath: string): Promise<Uint8Array | undefined> {
  const dir = await mkdtemp(join(tmpdir(), "hsdm-remote-"));
  try {
    const result = await runHs(["cms", "fetch", remotePath, dir], { accountId });
    if (!result.ok) return undefined;
    return await readFile(join(dir, remoteBasename(remotePath)));
  } catch {
    return undefined;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
