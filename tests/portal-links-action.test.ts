import { beforeEach, describe, expect, it, vi } from "vitest";

const prompts = vi.hoisted(() => ({
  select: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  select: prompts.select,
  isCancel: () => false,
  log: {
    warn: prompts.warn,
  },
}));

import type { HsAccount } from "../src/hs/accounts.js";
import { stripAnsi } from "../src/hs/watch-parser.js";
import { portalLinks, portalLinksAction } from "../src/actions/portal-links.js";

const account: HsAccount = { name: "example", accountId: "123456", isDefault: true };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("portalLinksAction", () => {
  it("shows every portal-scoped HubSpot destination and opens the selection", async () => {
    const links = portalLinks(account);
    prompts.select.mockResolvedValue(links[2]);
    const opener = vi.fn().mockResolvedValue(true);

    await portalLinksAction(account, opener);

    const prompt = prompts.select.mock.calls[0]![0];
    expect(prompt.message).toBe("Open HubSpot for example");
    expect(
      prompt.options.map((option: { label: string; hint?: string }) => ({
        label: stripAnsi(option.label),
        hint: option.hint,
      }))
    ).toEqual([
      { label: "↗ Design Manager", hint: "https://app.hubspot.com/design-manager/123456" },
      { label: "↗ Website pages", hint: "https://app.hubspot.com/website/123456/pages/site" },
      { label: "↗ HubDB tables", hint: "https://app.hubspot.com/hubdb/123456" },
      { label: "↗ Settings", hint: "https://app.hubspot.com/settings/123456" },
      { label: "↗ Files", hint: "https://app.hubspot.com/files/123456" },
      { label: "← Back", hint: undefined },
    ]);
    expect(opener).toHaveBeenCalledWith("https://app.hubspot.com/hubdb/123456");
  });

  it("shows the direct URL when the browser cannot be opened", async () => {
    const links = portalLinks(account);
    prompts.select.mockResolvedValue(links[4]);

    await portalLinksAction(account, vi.fn().mockResolvedValue(false));

    expect(prompts.warn).toHaveBeenCalledWith(
      "Could not open the browser. Visit: https://app.hubspot.com/files/123456"
    );
  });

  it("returns without opening a URL when Back is selected", async () => {
    prompts.select.mockImplementation(async (prompt) => prompt.options.at(-1)?.value);
    const opener = vi.fn();

    await portalLinksAction(account, opener);

    expect(opener).not.toHaveBeenCalled();
  });
});
