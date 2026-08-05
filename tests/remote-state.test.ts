import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadRemoteState,
  parseRemoteState,
  recordRemoteFiles,
  saveRemoteState,
  sha256,
  syncedHash,
} from "../src/state/remote-state.js";

describe("remote state", () => {
  it("hashes content deterministically", () => {
    expect(sha256("theme")).toBe(sha256(Buffer.from("theme")));
    expect(sha256("theme")).not.toBe(sha256("theme2"));
  });

  it("falls back to an empty state on malformed json", () => {
    expect(parseRemoteState("{ nope")).toEqual({ files: {} });
    expect(parseRemoteState('{"files":null}')).toEqual({ files: {} });
  });

  it("records hashes per portal and remote path without mutating the input", () => {
    const empty = { files: {} };
    const state = recordRemoteFiles(
      empty,
      "example-123456",
      [
        { remotePath: "/theme/main.css", sha256: "aaa" },
        { remotePath: "/theme/other.css", sha256: "bbb" },
      ],
      new Date("2026-08-03T12:00:00.000Z")
    );

    expect(empty.files).toEqual({});
    expect(syncedHash(state, "example-123456", "/theme/main.css")).toBe("aaa");
    expect(syncedHash(state, "other-999", "/theme/main.css")).toBeUndefined();
    expect(state.files["example-123456:/theme/other.css"]).toEqual({
      sha256: "bbb",
      synced_at: "2026-08-03T12:00:00.000Z",
    });
  });

  it("overwrites the previous hash of the same file", () => {
    const first = recordRemoteFiles({ files: {} }, "p-1", [{ remotePath: "/a.css", sha256: "old" }]);
    const second = recordRemoteFiles(first, "p-1", [{ remotePath: "/a.css", sha256: "new" }]);
    expect(syncedHash(second, "p-1", "/a.css")).toBe("new");
  });

  it("round-trips through disk and returns an empty state when missing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "hsdm-remote-state-"));
    expect(await loadRemoteState(cwd)).toEqual({ files: {} });

    await saveRemoteState(recordRemoteFiles({ files: {} }, "p-1", [{ remotePath: "/a.css", sha256: "aaa" }]), cwd);
    expect(syncedHash(await loadRemoteState(cwd), "p-1", "/a.css")).toBe("aaa");
  });
});
