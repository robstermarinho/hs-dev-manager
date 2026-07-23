import * as p from "@clack/prompts";
import { execa } from "execa";
import pc from "picocolors";

export function browserCommand(
  url: string,
  platform: NodeJS.Platform = process.platform
): { command: string; args: string[] } {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") return { command: "cmd", args: ["/d", "/s", "/c", "start", "", url] };
  return { command: "xdg-open", args: [url] };
}

/** Open a URL in the user's default browser. Best-effort; resolves false on failure. */
export async function openUrl(url: string): Promise<boolean> {
  const { command, args } = browserCommand(url);
  try {
    const result = await execa(command, args, { reject: false, stdio: "ignore" });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export function fail(message: string): never {
  p.cancel(message);
  process.exit(1);
}

export function handleCancel<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Bye!");
    process.exit(0);
  }
  return value;
}

export function dim(text: string): string {
  return pc.dim(text);
}

export function accent(text: string): string {
  return pc.cyan(text);
}

export const menuIcon = {
  add: "+",
  remove: "−",
  list: "≡",
  fetch: "↓",
  watch: "~",
  deploy: "↑",
  history: "↺",
  help: "?",
  back: "←",
  exit: "×",
  browse: "›",
  type: "/",
  open: "↗",
  path: "·",
  all: "*",
  use: "✓",
  up: "↑",
  folder: "›",
  module: "◆",
  file: "·",
} as const;

export type MenuIcon = keyof typeof menuIcon;

/** Prefix an interactive option with a compact, terminal-safe symbol. */
export function menuLabel(icon: MenuIcon, label: string): string {
  return `${accent(menuIcon[icon])} ${label}`;
}

interface TreeNode {
  children: Map<string, TreeNode>;
}

function insertPath(root: TreeNode, path: string): void {
  const segments = path.split("/").filter(Boolean);
  let node = root;
  for (const segment of segments) {
    let child = node.children.get(segment);
    if (!child) {
      child = { children: new Map() };
      node.children.set(segment, child);
    }
    node = child;
  }
}

function renderNode(node: TreeNode, prefix: string): string[] {
  const lines: string[] = [];
  const entries = [...node.children.entries()];
  entries.forEach(([name, child], index) => {
    const last = index === entries.length - 1;
    lines.push(`${prefix}${last ? "└─ " : "├─ "}${name}`);
    lines.push(...renderNode(child, `${prefix}${last ? "   " : "│  "}`));
  });
  return lines;
}

/** Render a list of remote paths as an indented tree, nesting shared segments. */
export function renderTree(paths: string[]): string {
  if (paths.length === 0) return dim("No saved paths yet — use “Configure new path”.");
  const root: TreeNode = { children: new Map() };
  for (const path of paths) insertPath(root, path);
  return renderNode(root, "").join("\n");
}
