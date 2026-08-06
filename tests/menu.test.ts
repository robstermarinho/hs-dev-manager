import { beforeEach, describe, expect, it, vi } from "vitest";

const prompts = vi.hoisted(() => ({
  select: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  select: prompts.select,
  isCancel: () => false,
}));

import type { HsAccount } from "../src/hs/accounts.js";
import { stripAnsi } from "../src/hs/watch-parser.js";
import { mainMenu, selectPortal } from "../src/menu.js";

const alpha: HsAccount = { name: "alpha", accountId: "111111", isDefault: true };
const beta: HsAccount = { name: "beta", accountId: "222222", isDefault: false };
const accounts = [alpha, beta];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("selectPortal", () => {
  it("prefers the last portal and describes every available choice", async () => {
    prompts.select.mockResolvedValue(beta);

    await expect(selectPortal(accounts, "222222")).resolves.toBe(beta);

    const prompt = prompts.select.mock.calls[0]![0];
    expect(prompt.initialValue).toBe(beta);
    expect(
      prompt.options.map((option: { label: string; hint?: string }) => ({
        label: stripAnsi(option.label),
        hint: option.hint,
      }))
    ).toEqual([
      { label: "alpha", hint: "111111 · default" },
      { label: "beta", hint: "222222 · last used" },
      { label: "+ Add portal", hint: "authenticate a new HubSpot account" },
    ]);
  });
});

describe("mainMenu", () => {
  it("returns the selected action and exposes the complete symbolic menu", async () => {
    prompts.select.mockResolvedValue("deploy");

    await expect(mainMenu(alpha)).resolves.toBe("deploy");

    const prompt = prompts.select.mock.calls[0]![0];
    expect(stripAnsi(prompt.message)).toBe("Portal alpha (111111)");
    expect(prompt.options.map((option: { label: string }) => stripAnsi(option.label))).toEqual([
      "≡ Paths",
      "↓ Fetch / update local",
      "~ Watch",
      "✔ Lint local files",
      "↑ Deploy",
      "↺ Deploy history",
      "↗ Open HubSpot",
      "? Help",
      "← Back",
      "× Exit",
    ]);
  });
});
