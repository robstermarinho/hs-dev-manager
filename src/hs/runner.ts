import { execa, type ResultPromise } from "execa";

export interface RunHsOptions {
  accountId?: string;
  cwd?: string;
}

export interface RunHsResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

function buildArgs(args: string[], options: RunHsOptions): string[] {
  const full = [...args];
  if (options.accountId) {
    full.push("--account", options.accountId);
  }
  return full;
}

export async function runHs(args: string[], options: RunHsOptions = {}): Promise<RunHsResult> {
  try {
    const result = await execa("hs", buildArgs(args, options), {
      cwd: options.cwd,
      reject: false,
    });
    return {
      ok: result.exitCode === 0,
      exitCode: result.exitCode ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, exitCode: 127, stdout: "", stderr: "hs CLI not found" };
    }
    throw error;
  }
}

export function spawnHs(args: string[], options: RunHsOptions = {}): ResultPromise {
  return execa("hs", buildArgs(args, options), {
    cwd: options.cwd,
    stdio: "inherit",
    reject: false,
  });
}
