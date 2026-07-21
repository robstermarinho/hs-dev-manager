import * as p from "@clack/prompts";
import pc from "picocolors";

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
