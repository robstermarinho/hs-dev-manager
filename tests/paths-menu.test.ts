import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as uiModule from "../src/ui.js";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  note: vi.fn(),
  configurePathAction: vi.fn(),
  removePathAction: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  select: mocks.select,
  isCancel: () => false,
  note: mocks.note,
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

// Only openUrl is stubbed: the rest of the ui helpers do the real rendering.
vi.mock("../src/ui.js", async (importOriginal) => ({
  ...(await importOriginal<typeof uiModule>()),
  openUrl: mocks.openUrl,
}));

vi.mock("../src/actions/fetch.js", () => ({ configurePathAction: mocks.configurePathAction }));
vi.mock("../src/actions/remove-path.js", () => ({ removePathAction: mocks.removePathAction }));

import { pathsAction } from "../src/actions/paths-menu.js";
import type { HsAccount } from "../src/hs/accounts.js";
import { recordFetch, saveFetchLog } from "../src/state/fetch-log.js";
import { addPath, savePathsConfig } from "../src/state/paths-config.js";

const account: HsAccount = { name: "example", accountId: "123456", isDefault: true };

function stripAnsi(text: string): string {
  return text.replace(/\[[0-9;]*m/g, "");
}

async function workspace(paths: string[]): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "hsdm-paths-menu-"));
  let config = { portals: {} };
  for (const path of paths) config = addPath(config, "example-123456", path);
  await savePathsConfig(config, cwd);
  return cwd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.openUrl.mockResolvedValue(true);
});

describe("pathsAction", () => {
  it("shows each saved path with its local status before asking anything", async () => {
    const cwd = await workspace(["/theme/templates", "/theme/modules"]);
    mocks.select.mockResolvedValue("__back__");

    await pathsAction(account, cwd);

    const [body, title] = mocks.note.mock.calls[0]!;
    expect(stripAnsi(body)).toContain("templates");
    expect(stripAnsi(body)).toContain("modules");
    expect(stripAnsi(title)).toContain("Saved paths");
    expect(mocks.select.mock.calls[0]![0].message).toBe("2 saved path(s)");
  });

  it("says which paths were never fetched and which are not on disk", async () => {
    const cwd = await workspace(["/theme"]);
    await saveFetchLog(recordFetch({ fetches: {} }, "example-123456", "/theme"), cwd);
    await mkdir(join(cwd, "src", "example-123456", "theme"), { recursive: true });
    mocks.select.mockResolvedValue("__back__");

    await pathsAction(account, cwd);

    expect(stripAnsi(mocks.note.mock.calls[0]![0])).toContain("fetched just now · downloaded");
  });

  it("marks a saved path that has no local directory", async () => {
    // Configured on another machine, or deleted locally: only a fetch brings it back.
    const cwd = await workspace(["/theme"]);
    mocks.select.mockResolvedValue("__back__");

    await pathsAction(account, cwd);

    expect(stripAnsi(mocks.note.mock.calls[0]![0])).toContain("never fetched · not downloaded");
  });

  it("opens the Design Manager without leaving the menu", async () => {
    const cwd = await workspace(["/theme"]);
    mocks.select.mockResolvedValueOnce("__open__").mockResolvedValueOnce("__back__");

    await pathsAction(account, cwd);

    expect(mocks.openUrl).toHaveBeenCalledWith("https://app.hubspot.com/design-manager/123456");
    expect(mocks.note).toHaveBeenCalledTimes(2);
  });

  it("hides removal when there is nothing to remove", async () => {
    const cwd = await workspace([]);
    mocks.select.mockResolvedValue("__back__");

    await pathsAction(account, cwd);

    const values = (mocks.select.mock.calls[0]![0].options as { value: string }[]).map((o) => o.value);
    // Opening the Design Manager needs no saved path, so it stays.
    expect(values).toEqual(["__configure__", "__open__", "__back__"]);
  });

  it("returns to the list after configuring, so the tree reflects the change", async () => {
    const cwd = await workspace(["/theme"]);
    mocks.select.mockResolvedValueOnce("__configure__").mockResolvedValueOnce("__back__");

    await pathsAction(account, cwd);

    expect(mocks.configurePathAction).toHaveBeenCalledWith(account, cwd);
    expect(mocks.note).toHaveBeenCalledTimes(2);
  });

  it("runs removal and comes back", async () => {
    const cwd = await workspace(["/theme"]);
    mocks.select.mockResolvedValueOnce("__remove__").mockResolvedValueOnce("__back__");

    await pathsAction(account, cwd);

    expect(mocks.removePathAction).toHaveBeenCalledWith(account, cwd);
  });
});
