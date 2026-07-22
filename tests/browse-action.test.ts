import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as RemoteLsModule from "../src/hs/remote-ls.js";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  listRemote: vi.fn(),
  spinnerStart: vi.fn(),
  spinnerStop: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  select: mocks.select,
  isCancel: () => false,
  spinner: () => ({ start: mocks.spinnerStart, stop: mocks.spinnerStop }),
}));

vi.mock("../src/hs/remote-ls.js", async (importOriginal) => {
  const actual = await importOriginal<typeof RemoteLsModule>();
  return { ...actual, listRemote: mocks.listRemote };
});

import { browseRemotePath } from "../src/actions/browse.js";
import type { HsAccount } from "../src/hs/accounts.js";

const account: HsAccount = { name: "example", accountId: "123456", isDefault: true };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("browseRemotePath", () => {
  it("navigates folders and returns a terminal module path", async () => {
    mocks.listRemote
      .mockResolvedValueOnce([{ name: "themes", kind: "folder" }])
      .mockResolvedValueOnce([{ name: "hero.module", kind: "module" }]);
    mocks.select.mockResolvedValueOnce("themes").mockResolvedValueOnce("hero.module");

    await expect(browseRemotePath(account)).resolves.toBe("/themes/hero.module");
    expect(mocks.listRemote).toHaveBeenNthCalledWith(1, "123456", "/");
    expect(mocks.listRemote).toHaveBeenNthCalledWith(2, "123456", "/themes");
  });

  it("returns undefined when the remote listing fails", async () => {
    mocks.listRemote.mockResolvedValue(undefined);

    await expect(browseRemotePath(account)).resolves.toBeUndefined();
    expect(mocks.spinnerStop).toHaveBeenCalledWith("Failed to list /", 1);
  });
});
