import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execa } from "execa";
import { beforeEach, describe, expect, it, vi } from "vitest";

const remote = vi.hoisted(() => ({ computeRemoteStatus: vi.fn() }));

const prompts = vi.hoisted(() => ({
  select: vi.fn(),
  text: vi.fn(),
  confirm: vi.fn(),
  note: vi.fn(),
  spinnerStart: vi.fn(),
  spinnerStop: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  message: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  select: prompts.select,
  text: prompts.text,
  confirm: prompts.confirm,
  note: prompts.note,
  spinner: () => ({ start: prompts.spinnerStart, stop: prompts.spinnerStop, message: vi.fn() }),
  isCancel: () => false,
  log: {
    warn: prompts.warn,
    error: prompts.error,
    info: prompts.info,
    success: prompts.success,
    message: prompts.message,
  },
}));

vi.mock("../src/actions/remote-status.js", () => ({ computeRemoteStatus: remote.computeRemoteStatus }));

import { configurePathAction, fetchAction } from "../src/actions/fetch.js";
import type { HsAccount } from "../src/hs/accounts.js";
import { changedFiles } from "../src/git.js";
import { driftTargets } from "../src/actions/fetch.js";
import { lastFetch, loadFetchLog } from "../src/state/fetch-log.js";
import { addPath, savePathsConfig } from "../src/state/paths-config.js";

const account: HsAccount = { name: "example", accountId: "123456", isDefault: true };

async function createRepo(): Promise<{ cwd: string; file: string }> {
  const cwd = await mkdtemp(join(tmpdir(), "hsdm-fetch-"));
  const file = join(cwd, "src", "example-123456", "theme", "main.css");
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, "before", "utf8");
  await execa("git", ["init", "--quiet"], { cwd });
  // Repo-local identity, not `git -c`: the code under test runs its own commits
  // and CI runners have no global one to fall back on.
  await execa("git", ["config", "user.name", "Test"], { cwd });
  await execa("git", ["config", "user.email", "test@example.com"], { cwd });
  await execa("git", ["add", "."], { cwd });
  await execa("git", ["commit", "-m", "base", "--quiet"], { cwd });
  await savePathsConfig(addPath({ portals: {} }, "example-123456", "/theme"), cwd);
  return { cwd, file };
}

/** Stand-in for a successful download: overwrites one tracked file and adds a new one. */
function downloadFrom(file: string) {
  return async (): Promise<boolean> => {
    await writeFile(file, "from hubspot", "utf8");
    await writeFile(join(dirname(file), "new.css"), "new from hubspot", "utf8");
    return true;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prompts.confirm.mockResolvedValue(true);
  remote.computeRemoteStatus.mockResolvedValue(inSync());
});

describe("fetchAction", () => {
  it("leaves partial results uncommitted when a fetch fails", async () => {
    const { cwd, file } = await createRepo();
    prompts.select.mockResolvedValue("/theme");

    await fetchAction(account, cwd, async () => {
      await writeFile(file, "partial", "utf8");
      return false;
    });

    expect(await changedFiles(cwd, "src/example-123456")).toEqual([
      "src/example-123456/theme/main.css",
    ]);
    expect((await execa("git", ["rev-list", "--count", "HEAD"], { cwd })).stdout).toBe("1");
    expect(prompts.warn).toHaveBeenCalledWith(expect.stringContaining("left uncommitted"));
  });

  it("commits the sync when the user reviews and confirms", async () => {
    const { cwd, file } = await createRepo();
    prompts.select.mockResolvedValueOnce("/theme").mockResolvedValueOnce("commit");

    await fetchAction(account, cwd, downloadFrom(file));

    expect(await changedFiles(cwd, "src/example-123456")).toEqual([]);
    expect((await execa("git", ["rev-list", "--count", "HEAD"], { cwd })).stdout).toBe("2");
    expect(prompts.success).toHaveBeenCalledWith(expect.stringContaining("Sync commit created"));
  });

  it("shows the diff and stays on the review prompt", async () => {
    const { cwd, file } = await createRepo();
    prompts.select.mockResolvedValueOnce("/theme").mockResolvedValueOnce("diff").mockResolvedValueOnce("commit");

    await fetchAction(account, cwd, downloadFrom(file));

    const diffNote = prompts.note.mock.calls.find(([, title]) => String(title).includes("hubspot → local"));
    expect(diffNote?.[0]).toContain("-before");
    expect(diffNote?.[0]).toContain("+from hubspot");
    expect((await execa("git", ["rev-list", "--count", "HEAD"], { cwd })).stdout).toBe("2");
  });

  it("undoes the fetch, restoring tracked files and deleting new ones", async () => {
    const { cwd, file } = await createRepo();
    prompts.select.mockResolvedValueOnce("/theme").mockResolvedValueOnce("revert");

    await fetchAction(account, cwd, downloadFrom(file));

    expect(await readFile(file, "utf8")).toBe("before");
    expect(existsSync(join(cwd, "src/example-123456/theme/new.css"))).toBe(false);
    expect(await changedFiles(cwd, "src/example-123456")).toEqual([]);
    expect((await execa("git", ["rev-list", "--count", "HEAD"], { cwd })).stdout).toBe("1");
  });

  it("keeps the changes in the working tree without staging them", async () => {
    const { cwd, file } = await createRepo();
    prompts.select.mockResolvedValueOnce("/theme").mockResolvedValueOnce("keep");

    await fetchAction(account, cwd, downloadFrom(file));

    expect(await readFile(file, "utf8")).toBe("from hubspot");
    expect((await execa("git", ["rev-list", "--count", "HEAD"], { cwd })).stdout).toBe("1");
    // "Leave uncommitted" must not leave the intent-to-add entries behind.
    expect((await execa("git", ["diff", "--cached", "--name-only"], { cwd })).stdout).toBe("");
  });

  it("lists what changed on HubSpot and hints each saved path", async () => {
    const { cwd, file } = await createRepo();
    await savePathsConfig(
      addPath(addPath({ portals: {} }, "example-123456", "/theme"), "example-123456", "/other"),
      cwd
    );
    remote.computeRemoteStatus.mockResolvedValue({
      changed: [{ path: "/theme/main.css", updated: 2, kind: "file" }],
      added: [{ path: "/theme/modules/hero.module", updated: 3, kind: "module" }],
      baselines: recordedFor("/theme", "/other"),
    });
    prompts.select.mockResolvedValueOnce("/theme").mockResolvedValueOnce("commit");

    await fetchAction(account, cwd, downloadFrom(file));

    const driftNote = prompts.note.mock.calls.find(([, title]) => String(title).includes("Changed on HubSpot"));
    expect(driftNote?.[0]).toContain("theme/modules/hero.module");
    expect(driftNote?.[0]).toContain("theme/main.css");
    expect(prompts.spinnerStop).toHaveBeenCalledWith(
      expect.stringContaining("1 changed on HubSpot · 1 new since your last fetch")
    );

    const options = prompts.select.mock.calls[0]![0].options as { value: string; hint?: string }[];
    expect(options.find((option) => option.value === "/theme")?.hint).toBe("1 changed · 1 new");
    expect(options.find((option) => option.value === "/other")?.hint).toBe("up to date");
  });

  it("continues without path hints when HubSpot cannot be checked", async () => {
    const { cwd, file } = await createRepo();
    remote.computeRemoteStatus.mockResolvedValue(undefined);
    prompts.select.mockResolvedValueOnce("/theme").mockResolvedValueOnce("commit");

    await fetchAction(account, cwd, downloadFrom(file));

    const options = prompts.select.mock.calls[0]![0].options as { value: string; hint?: string }[];
    expect(options.find((option) => option.value === "/theme")?.hint).toBeUndefined();
    // The fetch itself still runs.
    expect((await execa("git", ["rev-list", "--count", "HEAD"], { cwd })).stdout).toBe("2");
  });

  it("skips the HubSpot check when the environment opts out", async () => {
    const { cwd, file } = await createRepo();
    process.env.HSDM_NO_REMOTE_CHECK = "1";
    prompts.select.mockResolvedValueOnce("/theme").mockResolvedValueOnce("commit");

    try {
      await fetchAction(account, cwd, downloadFrom(file));
    } finally {
      delete process.env.HSDM_NO_REMOTE_CHECK;
    }

    expect(remote.computeRemoteStatus).not.toHaveBeenCalled();
  });

  it("downloads only the drifted assets of the chosen path", async () => {
    const { cwd, file } = await createRepo();
    remote.computeRemoteStatus.mockResolvedValue({
      changed: [{ path: "/theme/main.css", updated: 2, kind: "file" }],
      added: [{ path: "/theme/modules/hero.module", updated: 3, kind: "module" }],
      baselines: recordedFor("/theme", "/other"),
    });
    prompts.select
      .mockResolvedValueOnce("/theme")
      .mockResolvedValueOnce("targeted")
      .mockResolvedValueOnce("commit");
    const fetcher = vi.fn(async () => {
      await writeFile(file, "from hubspot", "utf8");
      return true;
    });

    await fetchAction(account, cwd, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
    // A file is written into its parent folder; a module fills its own.
    expect(fetcher).toHaveBeenNthCalledWith(1, account, "/theme/main.css", cwd, {
      destination: join(cwd, "src", "example-123456", "theme"),
    });
    expect(fetcher).toHaveBeenNthCalledWith(2, account, "/theme/modules/hero.module", cwd, {
      destination: join(cwd, "src", "example-123456", "theme", "modules", "hero.module"),
    });
    expect(prompts.success).toHaveBeenCalledWith("2 asset(s) updated");

    // The path is current again, so its age must not still point at the last
    // full re-download.
    expect(lastFetch(await loadFetchLog(cwd), "example-123456", "/theme")).toBeInstanceOf(Date);
  });

  it("leaves the path age alone when a targeted download fails", async () => {
    const { cwd } = await createRepo();
    remote.computeRemoteStatus.mockResolvedValue({
      changed: [{ path: "/theme/main.css", updated: 2, kind: "file" }],
      added: [],
      baselines: recordedFor("/theme"),
    });
    prompts.select.mockResolvedValueOnce("/theme").mockResolvedValueOnce("targeted");

    await fetchAction(account, cwd, vi.fn().mockResolvedValue(false));

    expect(lastFetch(await loadFetchLog(cwd), "example-123456", "/theme")).toBeUndefined();
  });

  it("goes straight to a full re-download when the path has no drift", async () => {
    const { cwd, file } = await createRepo();
    prompts.select.mockResolvedValueOnce("/theme").mockResolvedValueOnce("commit");
    const fetcher = vi.fn(downloadFrom(file));

    await fetchAction(account, cwd, fetcher);

    // Path picker, then the post-fetch review: no "how" prompt in between.
    expect(prompts.select.mock.calls[1]![0].message).toBe("2 local file(s) changed");
    expect(fetcher).toHaveBeenCalledWith(account, "/theme", cwd, { destination: undefined });
  });

  it("keeps the drift of other paths out of the targeted download", async () => {
    const { cwd, file } = await createRepo();
    await savePathsConfig(
      addPath(addPath({ portals: {} }, "example-123456", "/theme"), "example-123456", "/other"),
      cwd
    );
    remote.computeRemoteStatus.mockResolvedValue({
      changed: [
        { path: "/theme/main.css", updated: 2, kind: "file" },
        { path: "/other/site.css", updated: 2, kind: "file" },
      ],
      added: [],
      baselines: recordedFor("/theme"),
    });
    prompts.select
      .mockResolvedValueOnce("/theme")
      .mockResolvedValueOnce("targeted")
      .mockResolvedValueOnce("commit");
    const fetcher = vi.fn(async () => {
      await writeFile(file, "from hubspot", "utf8");
      return true;
    });

    await fetchAction(account, cwd, fetcher);

    expect(prompts.select.mock.calls[1]![0].message).toBe("Update /theme");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(account, "/theme/main.css", cwd, expect.anything());
  });

  it("re-downloads the whole path when asked, even with drift", async () => {
    const { cwd, file } = await createRepo();
    remote.computeRemoteStatus.mockResolvedValue({
      changed: [{ path: "/theme/main.css", updated: 2, kind: "file" }],
      added: [],
      baselines: recordedFor("/theme"),
    });
    prompts.select
      .mockResolvedValueOnce("/theme")
      .mockResolvedValueOnce("__full__")
      .mockResolvedValueOnce("commit");
    const fetcher = vi.fn(downloadFrom(file));

    await fetchAction(account, cwd, fetcher);

    expect(fetcher).toHaveBeenCalledWith(account, "/theme", cwd, { destination: undefined });
    expect(prompts.success).toHaveBeenCalledWith("1 path(s) updated");
  });

  it("skips files already covered by a drifted module", async () => {
    const { cwd, file } = await createRepo();
    remote.computeRemoteStatus.mockResolvedValue({
      changed: [
        { path: "/theme/modules/hero.module", updated: 3, kind: "module" },
        { path: "/theme/modules/hero.module/module.html", updated: 3, kind: "file" },
      ],
      added: [],
      baselines: recordedFor("/theme"),
    });
    prompts.select
      .mockResolvedValueOnce("/theme")
      .mockResolvedValueOnce("targeted")
      .mockResolvedValueOnce("commit");
    const fetcher = vi.fn(async () => {
      await writeFile(file, "from hubspot", "utf8");
      return true;
    });

    await fetchAction(account, cwd, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(account, "/theme/modules/hero.module", cwd, expect.anything());
  });

  it("reverts JSON files that only came back with their keys reordered", async () => {
    const { cwd } = await createRepo();
    const fields = join(cwd, "src", "example-123456", "theme", "fields.json");
    const original = '[\n  {\n    "display_width" : null,\n    "type" : "text"\n  }\n]\n';
    await writeFile(fields, original, "utf8");
    await execa("git", ["add", "."], { cwd });
    await execa("git", ["commit", "-m", "fields", "--quiet"], { cwd });

    // Only the path is answered: the review prompt is never reached, and a
    // queued answer would leak into the next test.
    prompts.select.mockResolvedValueOnce("/theme");

    await fetchAction(account, cwd, async () => {
      // Same fields, the order HubSpot's serializer happened to pick this time.
      await writeFile(fields, '[\n  {\n    "type" : "text",\n    "display_width" : null\n  }\n]\n', "utf8");
      return true;
    });

    expect(await readFile(fields, "utf8")).toBe(original);
    expect(prompts.info).toHaveBeenCalledWith(expect.stringContaining("only in key order"));
    // Nothing of substance came down, so there is nothing to commit.
    expect((await execa("git", ["rev-list", "--count", "HEAD"], { cwd })).stdout).toBe("2");
  });

  it("keeps a JSON file whose values actually changed", async () => {
    const { cwd } = await createRepo();
    const fields = join(cwd, "src", "example-123456", "theme", "fields.json");
    await writeFile(fields, '[{ "type": "text" }]\n', "utf8");
    await execa("git", ["add", "."], { cwd });
    await execa("git", ["commit", "-m", "fields", "--quiet"], { cwd });

    prompts.select.mockResolvedValueOnce("/theme").mockResolvedValueOnce("commit");

    await fetchAction(account, cwd, async () => {
      await writeFile(fields, '[{ "type": "richtext" }]\n', "utf8");
      return true;
    });

    expect(await readFile(fields, "utf8")).toBe('[{ "type": "richtext" }]\n');
    expect(prompts.success).toHaveBeenCalledWith(expect.stringContaining("Sync commit created"));
  });
});

describe("configurePathAction", () => {
  it("offers to initialize a repository before writing anything", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "hsdm-fetch-norepo-"));
    prompts.select.mockResolvedValue("type");
    prompts.text.mockResolvedValue("/theme");
    const fetcher = vi.fn().mockResolvedValue(true);

    await configurePathAction(account, cwd, fetcher);

    expect(prompts.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("not a git repository") })
    );
    expect(existsSync(join(cwd, ".git"))).toBe(true);
    expect(await readFile(join(cwd, ".gitignore"), "utf8")).toContain("db/");
    expect(fetcher).toHaveBeenCalled();
  });

  it("keeps going without a repository when the offer is declined", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "hsdm-fetch-norepo-"));
    prompts.select.mockResolvedValue("type");
    prompts.text.mockResolvedValue("/theme");
    prompts.confirm.mockResolvedValue(false);
    const fetcher = vi.fn().mockResolvedValue(true);

    await configurePathAction(account, cwd, fetcher);

    expect(existsSync(join(cwd, ".git"))).toBe(false);
    expect(existsSync(join(cwd, ".gitignore"))).toBe(false);
    // The download still happens: git is only needed for commits.
    expect(fetcher).toHaveBeenCalled();
  });

  it("does not ask about .gitignore when it already covers the local state", async () => {
    const { cwd } = await createRepo();
    await writeFile(join(cwd, ".gitignore"), ["db/", ".hsaccount", ""].join("\n"), "utf8");
    prompts.select.mockResolvedValue("type");
    prompts.text.mockResolvedValue("/theme2");

    await configurePathAction(account, cwd, vi.fn().mockResolvedValue(true));

    const asked = prompts.confirm.mock.calls.some(([options]) =>
      String((options as { message: string }).message).includes(".gitignore")
    );
    expect(asked).toBe(false);
  });

  it("does not overwrite or commit when the portal scope is dirty", async () => {
    const { cwd, file } = await createRepo();
    await writeFile(file, "local work", "utf8");
    prompts.select.mockResolvedValue("type");
    prompts.text.mockResolvedValue("/theme");
    const fetcher = vi.fn().mockResolvedValue(true);

    await configurePathAction(account, cwd, fetcher);

    expect(fetcher).not.toHaveBeenCalled();
    expect(prompts.error).toHaveBeenCalledWith(expect.stringContaining("Uncommitted changes"));
    // The guard runs before the path picker, so the user is never prompted.
    expect(prompts.select).not.toHaveBeenCalled();
    expect(prompts.text).not.toHaveBeenCalled();
  });
});

function driftItem(path: string, updated: number, kind: "file" | "module" = "file") {
  return { path, updated, kind };
}

describe("driftTargets", () => {
  it("keeps one entry per asset and drops files a drifted module already covers", () => {
    const targets = driftTargets({
      changed: [
        driftItem("/theme/modules/hero.module", 3, "module"),
        driftItem("/theme/modules/hero.module/module.html", 3),
        driftItem("/theme/main.css", 2),
      ],
      added: [driftItem("/theme/modules/other.module/fields.json", 4)],
    });
    expect(targets.map((entry) => entry.path)).toEqual([
      "/theme/modules/hero.module",
      "/theme/main.css",
      "/theme/modules/other.module/fields.json",
    ]);
  });
});

/** Baseline map for a check that had a recorded sync for every saved path. */
function recordedFor(...paths: string[]): Map<string, "recorded"> {
  return new Map(paths.map((path) => [path, "recorded"]));
}

/** A clean check: nothing drifted and every saved path had a real baseline. */
function inSync(...paths: string[]) {
  return { changed: [], added: [], baselines: recordedFor(...(paths.length > 0 ? paths : ["/theme"])) };
}
