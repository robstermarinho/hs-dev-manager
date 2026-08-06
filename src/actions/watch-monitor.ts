import pc from "picocolors";
import type { WatchEvent } from "../hs/watch-parser.js";

export interface WatchStats {
  uploaded: number;
  deleted: number;
  errors: number;
  files: Set<string>;
  preview?: string;
}

export function createWatchStats(): WatchStats {
  return { uploaded: 0, deleted: 0, errors: 0, files: new Set() };
}

function clock(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Drop a watched-root prefix so uploaded paths read short (e.g. modules/x.html). */
export function stripRoot(remotePath: string, root?: string): string {
  let path = remotePath;
  if (root && path.startsWith(root)) path = path.slice(root.length);
  return path.replace(/^\/+/, "");
}

/**
 * Fold an event into the running stats and return a formatted line to print,
 * or undefined for events that only update state (ready / preview).
 */
export function applyEvent(stats: WatchStats, event: WatchEvent, root?: string): string | undefined {
  const time = pc.dim(clock());
  switch (event.type) {
    case "uploaded": {
      stats.uploaded++;
      stats.files.add(event.remotePath);
      const counter = pc.dim(`[↑${stats.uploaded}]`);
      return `${time} ${pc.green("✓")} ${counter} ${stripRoot(event.remotePath, root)}`;
    }
    case "deleted": {
      stats.deleted++;
      return `${time} ${pc.yellow("−")} ${pc.dim("[del]")} ${stripRoot(event.remotePath, root)}`;
    }
    case "error": {
      stats.errors++;
      return `${time} ${pc.red("✗")} ${pc.red(event.message)}`;
    }
    case "preview":
      stats.preview = event.url;
      return undefined;
    case "ready":
      return `${time} ${pc.cyan("●")} watching ${pc.dim(event.dir)}`;
    case "raw":
      // Unrecognized hs output: keep it visible but understated.
      return `${time} ${pc.dim(event.message)}`;
  }
}

/** Lines for the end-of-watch summary panel. */
export function summaryLines(stats: WatchStats): string[] {
  const parts = [
    `${pc.green(`${stats.uploaded} uploaded`)}`,
    stats.deleted > 0 ? pc.yellow(`${stats.deleted} deleted`) : undefined,
    stats.errors > 0 ? pc.red(`${stats.errors} error(s)`) : pc.dim("0 errors"),
    pc.dim(`${stats.files.size} file(s)`),
  ].filter(Boolean);
  const lines = [parts.join(pc.dim(" · "))];
  if (stats.preview) lines.push(pc.dim(`Preview: ${stats.preview}`));
  return lines;
}
