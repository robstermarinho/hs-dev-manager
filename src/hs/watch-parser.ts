/** Structured events parsed from the raw `hs cms watch` output. */
export type WatchEvent =
  | { type: "ready"; dir: string }
  | { type: "uploaded"; localPath: string; remotePath: string }
  | { type: "deleted"; remotePath: string }
  | { type: "preview"; url: string }
  | { type: "error"; message: string }
  | { type: "raw"; message: string };

// ANSI color sequences begin with the ESC control character by definition.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

/** Remove ANSI color codes and trim a log line. */
export function stripAnsi(line: string): string {
  return line.replace(ANSI, "").trim();
}

/**
 * Parse a single line of `hs cms watch` output into a structured event.
 * Returns undefined for lines we don't care to surface.
 */
export function parseWatchLine(rawLine: string): WatchEvent | undefined {
  const line = stripAnsi(rawLine);
  if (!line) return undefined;

  const ready = line.match(/^Watcher is ready and watching (.+?)\. Any changes/);
  if (ready?.[1]) return { type: "ready", dir: ready[1] };

  const uploaded = line.match(/^Uploaded file (.+?) to (.+)$/);
  if (uploaded?.[1] && uploaded[2]) {
    return { type: "uploaded", localPath: uploaded[1], remotePath: uploaded[2] };
  }

  const deleted = line.match(/^Deleted (?:file )?(.+?)(?: (?:from|on|in) .+)?$/);
  if (deleted?.[1]) return { type: "deleted", remotePath: deleted[1] };

  const preview = line.match(/visit:\s*(https?:\/\/\S+)/);
  if (preview?.[1]) return { type: "preview", url: preview[1] };

  if (/\b(error|failed|failure|cannot|unable)\b/i.test(line)) {
    return { type: "error", message: line };
  }

  return { type: "raw", message: line };
}
