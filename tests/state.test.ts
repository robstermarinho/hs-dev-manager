import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addPath,
  loadPathsConfig,
  normalizeRemotePath,
  parsePathsConfig,
  portalPaths,
  removePath,
  savePathsConfig,
} from "../src/state/paths-config.js";
import {
  addDeploy,
  loadHistory,
  MAX_DEPLOYS,
  parseHistory,
  saveHistory,
  timestampNow,
  type DeployRecord,
} from "../src/state/history.js";
import { loadLastPortalId, saveLastPortalId } from "../src/state/last-portal.js";

describe("normalizeRemotePath", () => {
  it("adds leading slash and strips trailing slashes", () => {
    expect(normalizeRemotePath("foo/bar")).toBe("/foo/bar");
    expect(normalizeRemotePath("/foo/bar///")).toBe("/foo/bar");
    expect(normalizeRemotePath(" /foo ")).toBe("/foo");
    expect(normalizeRemotePath("//foo///bar//")).toBe("/foo/bar");
    expect(normalizeRemotePath("")).toBe("");
  });

  it("rejects paths that could escape the local portal directory", () => {
    expect(normalizeRemotePath("/foo/../bar")).toBe("");
    expect(normalizeRemotePath("/foo/./bar")).toBe("");
    expect(normalizeRemotePath("foo\\bar")).toBe("");
  });
});

describe("paths config", () => {
  it("parses sh-compatible schema and tolerates garbage", () => {
    const config = parsePathsConfig('{"portals":{"alpha-1":{"paths":["/a","/b"]}}}');
    expect(portalPaths(config, "alpha-1")).toEqual(["/a", "/b"]);
    expect(parsePathsConfig("not json")).toEqual({ portals: {} });
    expect(parsePathsConfig('{"portals":{"x":{"paths":"bad"}}}')).toEqual({ portals: { x: { paths: [] } } });
  });

  it("adds paths without duplicates and removes them", () => {
    let config = parsePathsConfig("{}");
    config = addPath(config, "alpha-1", "foo/");
    config = addPath(config, "alpha-1", "/foo");
    expect(portalPaths(config, "alpha-1")).toEqual(["/foo"]);
    config = removePath(config, "alpha-1", "/foo");
    expect(portalPaths(config, "alpha-1")).toEqual([]);
  });

  it("round-trips via disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hsdm-"));
    await savePathsConfig(addPath({ portals: {} }, "beta-2", "/x"), dir);
    const loaded = await loadPathsConfig(dir);
    expect(portalPaths(loaded, "beta-2")).toEqual(["/x"]);
    const raw = JSON.parse(await readFile(join(dir, "paths-config.json"), "utf8"));
    expect(raw.portals["beta-2"].paths).toEqual(["/x"]);
  });
});

function record(message: string): DeployRecord {
  return {
    timestamp: timestampNow(new Date("2026-07-03T10:00:00")),
    portal: "alpha",
    portal_id: "1",
    message,
    status: "success",
    file_count: 1,
    files: ["a.html"],
  };
}

describe("deploy history", () => {
  it("formats timestamp like the sh version", () => {
    expect(timestampNow(new Date("2026-07-03T09:05:01"))).toBe("2026-07-03 09:05:01");
  });

  it("prepends and caps at MAX_DEPLOYS", () => {
    let history = parseHistory("{}");
    for (let i = 0; i < MAX_DEPLOYS + 5; i++) {
      history = addDeploy(history, record(`deploy ${i}`));
    }
    expect(history.deploys).toHaveLength(MAX_DEPLOYS);
    expect(history.deploys[0]?.message).toBe(`deploy ${MAX_DEPLOYS + 4}`);
  });

  it("round-trips via disk creating db/ dir", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hsdm-"));
    await saveHistory(addDeploy({ deploys: [] }, record("first")), dir);
    const loaded = await loadHistory(dir);
    expect(loaded.deploys[0]?.message).toBe("first");
  });
});

describe("last selected portal", () => {
  it("persists and reloads a numeric account id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hsdm-"));
    await saveLastPortalId({ name: "example", accountId: "123456", isDefault: true }, dir);
    await expect(loadLastPortalId(dir)).resolves.toBe("123456");
  });

  it("ignores a missing or invalid state file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hsdm-"));
    await expect(loadLastPortalId(dir)).resolves.toBeUndefined();
    await writeFile(join(dir, ".hsaccount"), "not-an-id\n", "utf8");
    await expect(loadLastPortalId(dir)).resolves.toBeUndefined();
  });
});
