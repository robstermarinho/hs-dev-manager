import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as AccountsModule from "../src/hs/accounts.js";

const mocks = vi.hoisted(() => ({
  spawnHs: vi.fn(),
  discoverAccounts: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  log: { warn: mocks.warn, info: mocks.info, success: mocks.success },
}));

vi.mock("../src/hs/runner.js", () => ({ spawnHs: mocks.spawnHs }));
vi.mock("../src/hs/accounts.js", async (importOriginal) => {
  const actual = await importOriginal<typeof AccountsModule>();
  return { ...actual, discoverAccounts: mocks.discoverAccounts };
});

import { addPortalAction } from "../src/actions/portal.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("addPortalAction", () => {
  it("returns refreshed accounts after successful authentication", async () => {
    mocks.spawnHs.mockResolvedValue({ exitCode: 0 });
    mocks.discoverAccounts.mockResolvedValue({
      accounts: [{ name: "example", accountId: "123456", isDefault: true }],
      source: "test",
    });

    await expect(addPortalAction()).resolves.toMatchObject({ source: "test" });
    expect(mocks.spawnHs).toHaveBeenCalledWith(["account", "auth"]);
  });

  it("does not refresh accounts when authentication is cancelled", async () => {
    mocks.spawnHs.mockResolvedValue({ exitCode: 1 });
    await expect(addPortalAction()).resolves.toBeUndefined();
    expect(mocks.discoverAccounts).not.toHaveBeenCalled();
  });
});
