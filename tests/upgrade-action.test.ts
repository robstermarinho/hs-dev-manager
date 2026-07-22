import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as VersionModule from "../src/hs/version.js";

const mocks = vi.hoisted(() => ({
  execa: vi.fn(),
  latestHsVersion: vi.fn(),
  checkHsCli: vi.fn(),
  confirm: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  spinnerStart: vi.fn(),
  spinnerStop: vi.fn(),
}));

vi.mock("execa", () => ({ execa: mocks.execa }));
vi.mock("@clack/prompts", () => ({
  confirm: mocks.confirm,
  isCancel: () => false,
  spinner: () => ({ start: mocks.spinnerStart, stop: mocks.spinnerStop }),
  log: { info: mocks.info, error: mocks.error },
}));
vi.mock("../src/hs/version.js", async (importOriginal) => {
  const actual = await importOriginal<typeof VersionModule>();
  return {
    ...actual,
    latestHsVersion: mocks.latestHsVersion,
    checkHsCli: mocks.checkHsCli,
  };
});

import { offerHsUpgrade } from "../src/actions/upgrade.js";
import type { HsCliStatus } from "../src/hs/version.js";

const installed: HsCliStatus = {
  installed: true,
  version: "8.9.0",
  major: 8,
  support: "ok",
  supported: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.latestHsVersion.mockResolvedValue("8.10.0");
});

describe("offerHsUpgrade", () => {
  it("does not run npm when the user declines", async () => {
    mocks.confirm.mockResolvedValue(false);
    await expect(offerHsUpgrade(installed)).resolves.toBe(installed);
    expect(mocks.execa).not.toHaveBeenCalled();
  });

  it("returns a refreshed status after a successful confirmed upgrade", async () => {
    const refreshed = { ...installed, version: "8.10.0" };
    mocks.confirm.mockResolvedValue(true);
    mocks.execa.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    mocks.checkHsCli.mockResolvedValue(refreshed);

    await expect(offerHsUpgrade(installed)).resolves.toEqual(refreshed);
    expect(mocks.execa).toHaveBeenCalledWith("npm", ["install", "-g", "@hubspot/cli@8.10.0"], {
      reject: false,
    });
  });
});
