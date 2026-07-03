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
