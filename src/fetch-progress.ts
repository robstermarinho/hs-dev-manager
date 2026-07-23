import { readdir } from "node:fs/promises";
import { join } from "node:path";

const BRAILLE_ACTIVITY = ["⣀", "⣤", "⣶", "⣿", "⣶", "⣤"] as const;
const IGNORED_LOCAL_DIRECTORIES = new Set([".git", "node_modules"]);

async function countFilesIn(directory: string): Promise<number> {
  let total = 0;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_LOCAL_DIRECTORIES.has(entry.name)) continue;
      total += await countFilesIn(join(directory, entry.name));
    } else if (entry.isFile()) {
      total++;
    }
  }
  return total;
}

/** Count regular files without following symlinks. Missing or unreadable paths have no usable baseline. */
export async function countLocalFiles(directory: string): Promise<number> {
  try {
    return await countFilesIn(directory);
  } catch {
    return 0;
  }
}

function fileLabel(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

function activitySparkline(step: number, width: number = 4): string {
  return Array.from(
    { length: width },
    (_, index) => BRAILLE_ACTIVITY[(Math.max(0, step) + index) % BRAILLE_ACTIVITY.length]
  ).join("");
}

export function progressBar(ratio: number, width: number = 12): string {
  const safeWidth = Math.max(1, Math.floor(width));
  const bounded = Math.max(0, Math.min(1, ratio));
  const units = bounded * safeWidth;
  const full = Math.floor(units);
  const fraction = units - full;
  const partial = fraction >= 0.66 ? "▓" : fraction >= 0.33 ? "▒" : fraction > 0 ? "░" : "";
  const filled = "█".repeat(full);
  const remaining = "░".repeat(Math.max(0, safeWidth - full - (partial ? 1 : 0)));
  return `[${filled}${partial}${remaining}]`;
}

/**
 * Render honest fetch feedback. A local file count is only a baseline, so the
 * estimate never reaches 100% before the HubSpot process reports success.
 */
export function renderFetchProgress(downloaded: number, localBaseline: number, width: number = 12): string {
  if (localBaseline <= 0) {
    return `${activitySparkline(downloaded)} ${fileLabel(downloaded)} · total unknown`;
  }

  const ratio = Math.min(downloaded / localBaseline, 0.95);
  const percent = Math.round(ratio * 100);
  return `${progressBar(ratio, width)} ~${percent}% · ${downloaded}/~${localBaseline} files`;
}

export function renderFetchComplete(downloaded: number, width: number = 12): string {
  return `${progressBar(1, width)} 100% · ${fileLabel(downloaded)}`;
}
