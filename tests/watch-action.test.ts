import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as FetchModule from "../src/actions/fetch.js";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  confirm: vi.fn(),
  note: vi.fn(),
  spinnerStop: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  computeRemoteStatus: vi.fn(),
  fetchRemotePath: vi.fn(),
  portalGitState: vi.fn(),
  streamHs: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  select: mocks.select,
  confirm: mocks.confirm,
  note: mocks.note,
  isCancel: () => false,
  spinner: () => ({ start: vi.fn(), stop: mocks.spinnerStop, message: vi.fn() }),
  log: { warn: mocks.warn, info: mocks.info, error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

vi.mock("../src/actions/remote-status.js", () => ({ computeRemoteStatus: mocks.computeRemoteStatus }));

vi.mock("../src/actions/fetch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof FetchModule>();
  return {
    ...actual,
    fetchRemotePath: mocks.fetchRemotePath,
    portalGitState: mocks.portalGitState,
  };
});

vi.mock("../src/hs/runner.js", () => ({ streamHs: mocks.streamHs }));

import { watchAction } from "../src/actions/watch.js";
import type { HsAccount } from "../src/hs/accounts.js";
import { addPath, savePathsConfig } from "../src/state/paths-config.js";

const account: HsAccount = { name: "example", accountId: "123456", isDefault: true };

async function workspace(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "hsdm-watch-"));
  await mkdir(join(cwd, "src", "example-123456", "theme"), { recursive: true });
  await savePathsConfig(addPath({ portals: {} }, "example-123456", "/theme"), cwd);
  return cwd;
}

/** A watch child that ends immediately. */
function watchChild(): Promise<void> & { stdout: null; stderr: null; kill: () => void } {
  const promise = Promise.resolve() as Promise<void> & { stdout: null; stderr: null; kill: () => void };
  promise.stdout = null;
  promise.stderr = null;
  promise.kill = () => {};
  return promise;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.HSDM_NO_REMOTE_CHECK;
  mocks.streamHs.mockImplementation(() => watchChild());
  mocks.portalGitState.mockResolvedValue({ inRepo: false, scope: "src/example-123456", dirty: [] });
  mocks.fetchRemotePath.mockResolvedValue(true);
});

afterEach(() => {
  delete process.env.HSDM_NO_REMOTE_CHECK;
});

describe("watchAction", () => {
  it("starts watching without asking when HubSpot matches the local copy", async () => {
    const cwd = await workspace();
    mocks.computeRemoteStatus.mockResolvedValue({ changed: [], added: [] });
    mocks.select.mockResolvedValueOnce("/theme");

    await watchAction(account, cwd);

    expect(mocks.spinnerStop).toHaveBeenCalledWith(expect.stringContaining("HubSpot matches your local copy"));
    // No sync prompt, no download: straight into the watch.
    expect(mocks.select).toHaveBeenCalledTimes(1);
    expect(mocks.fetchRemotePath).not.toHaveBeenCalled();
    expect(mocks.streamHs).toHaveBeenCalledWith(
      ["cms", "watch", join(cwd, "src", "example-123456", "theme"), "/theme"],
      { accountId: "123456", cwd }
    );
  });

  it("offers to sync what changed and downloads only those assets", async () => {
    const cwd = await workspace();
    mocks.computeRemoteStatus.mockResolvedValue({
      changed: [{ path: "/theme/main.css", updated: 2, kind: "file" }],
      added: [{ path: "/theme/modules/hero.module", updated: 3, kind: "module" }],
    });
    mocks.select.mockResolvedValueOnce("/theme").mockResolvedValueOnce("targeted");

    await watchAction(account, cwd);

    expect(mocks.note).toHaveBeenCalledWith(
      expect.stringContaining("theme/main.css"),
      expect.stringContaining("Changed on HubSpot")
    );
    expect(mocks.fetchRemotePath).toHaveBeenCalledTimes(2);
    expect(mocks.fetchRemotePath).toHaveBeenNthCalledWith(1, account, "/theme/main.css", cwd, {
      destination: join(cwd, "src", "example-123456", "theme"),
    });
    expect(mocks.streamHs).toHaveBeenCalled();
  });

  it("can start watching anyway with a stale local copy", async () => {
    const cwd = await workspace();
    mocks.computeRemoteStatus.mockResolvedValue({
      changed: [{ path: "/theme/main.css", updated: 2, kind: "file" }],
      added: [],
    });
    mocks.select.mockResolvedValueOnce("/theme").mockResolvedValueOnce("__skip__");

    await watchAction(account, cwd);

    expect(mocks.fetchRemotePath).not.toHaveBeenCalled();
    expect(mocks.streamHs).toHaveBeenCalled();
  });

  it("goes back to the menu without watching", async () => {
    const cwd = await workspace();
    mocks.computeRemoteStatus.mockResolvedValue({
      changed: [{ path: "/theme/main.css", updated: 2, kind: "file" }],
      added: [],
    });
    mocks.select.mockResolvedValueOnce("/theme").mockResolvedValueOnce("__back__");

    await watchAction(account, cwd);

    expect(mocks.streamHs).not.toHaveBeenCalled();
  });

  it("refuses to overwrite uncommitted work before watching", async () => {
    const cwd = await workspace();
    mocks.computeRemoteStatus.mockResolvedValue({
      changed: [{ path: "/theme/main.css", updated: 2, kind: "file" }],
      added: [],
    });
    mocks.portalGitState.mockResolvedValue({
      inRepo: true,
      scope: "src/example-123456",
      dirty: ["src/example-123456/theme/main.css"],
    });
    mocks.select.mockResolvedValueOnce("/theme").mockResolvedValueOnce("targeted");

    await watchAction(account, cwd);

    expect(mocks.fetchRemotePath).not.toHaveBeenCalled();
    expect(mocks.streamHs).not.toHaveBeenCalled();
  });

  it("falls back to the blind offer when HubSpot cannot be checked", async () => {
    const cwd = await workspace();
    mocks.computeRemoteStatus.mockResolvedValue(undefined);
    mocks.select.mockResolvedValueOnce("/theme");
    mocks.confirm.mockResolvedValueOnce(true);

    await watchAction(account, cwd);

    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Fetch latest from HubSpot before watching?") })
    );
    expect(mocks.fetchRemotePath).toHaveBeenCalledWith(account, "/theme", cwd, { destination: undefined });
  });

  it("skips the check and the question when the environment opts out", async () => {
    const cwd = await workspace();
    process.env.HSDM_NO_REMOTE_CHECK = "1";
    mocks.select.mockResolvedValueOnce("/theme");
    mocks.confirm.mockResolvedValueOnce(false);

    await watchAction(account, cwd);

    expect(mocks.computeRemoteStatus).not.toHaveBeenCalled();
    expect(mocks.streamHs).toHaveBeenCalled();
  });
});
