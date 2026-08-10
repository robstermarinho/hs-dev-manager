import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runHs: vi.fn() }));

vi.mock("../src/hs/runner.js", () => ({ runHs: mocks.runHs }));

import { readRemoteFile, remoteBasename } from "../src/hs/remote-file.js";

const ok = { ok: true, exitCode: 0, stdout: "", stderr: "" };
const failed = { ok: false, exitCode: 1, stdout: "", stderr: "not found" };

/** Answer a fetch by writing the file `hs cms fetch` would have written. */
function writesFile(name: string, content: string) {
  return async (args: string[]) => {
    const destination = args[3] as string;
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, name), content, "utf8");
    return ok;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("remoteBasename", () => {
  it("takes the last segment, with or without a leading slash", () => {
    expect(remoteBasename("/theme/css/main.css")).toBe("main.css");
    expect(remoteBasename("theme/css/main.css")).toBe("main.css");
    expect(remoteBasename("/theme/modules/hero.module/module.html")).toBe("module.html");
  });

  it("is empty for a path with no segments", () => {
    expect(remoteBasename("/")).toBe("");
  });
});

describe("readRemoteFile", () => {
  it("downloads into a temp directory and returns the bytes", async () => {
    mocks.runHs.mockImplementation(writesFile("main.css", "body { color: red }"));

    const content = await readRemoteFile("123456", "/theme/css/main.css");

    expect(content && Buffer.from(content).toString("utf8")).toBe("body { color: red }");
    const [args, options] = mocks.runHs.mock.calls[0] as [string[], { accountId: string }];
    expect(args.slice(0, 3)).toEqual(["cms", "fetch", "/theme/css/main.css"]);
    expect(options).toEqual({ accountId: "123456" });
  });

  it("removes the temp directory afterwards", async () => {
    let destination = "";
    mocks.runHs.mockImplementation(async (args: string[]) => {
      destination = args[3] as string;
      return writesFile("main.css", "x")(args);
    });

    await readRemoteFile("123456", "/theme/css/main.css");

    expect(destination).not.toBe("");
    expect(existsSync(destination)).toBe(false);
  });

  it("is undefined when the download fails", async () => {
    mocks.runHs.mockResolvedValue(failed);

    await expect(readRemoteFile("123456", "/theme/missing.css")).resolves.toBeUndefined();
  });

  it("is undefined when the download reports success but writes nothing", async () => {
    mocks.runHs.mockResolvedValue(ok);

    await expect(readRemoteFile("123456", "/theme/css/main.css")).resolves.toBeUndefined();
  });

  it("cleans up even when the download throws", async () => {
    mocks.runHs.mockRejectedValue(new Error("hs exploded"));

    await expect(readRemoteFile("123456", "/theme/css/main.css")).resolves.toBeUndefined();
  });

  it("reads a file from inside a module", async () => {
    mocks.runHs.mockImplementation(writesFile("module.html", "<div></div>"));

    const content = await readRemoteFile("123456", "/theme/modules/hero.module/module.html");

    expect(content && Buffer.from(content).toString("utf8")).toBe("<div></div>");
  });
});
