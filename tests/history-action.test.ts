import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prompts = vi.hoisted(() => ({
  select: vi.fn(),
  note: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  select: prompts.select,
  isCancel: () => false,
  note: prompts.note,
  log: { warn: prompts.warn, error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import { historyAction } from "../src/actions/history.js";
import type { HsAccount } from "../src/hs/accounts.js";
import { saveHistory, type DeployRecord } from "../src/state/history.js";

const account: HsAccount = { name: "example", accountId: "123456", isDefault: true };

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\[[0-9;]*m/g, "");
}

function deploy(index: number, overrides: Partial<DeployRecord> = {}): DeployRecord {
  return {
    timestamp: `2026-08-05 ${String(23 - index).padStart(2, "0")}:00:00`,
    portal: "example",
    portal_id: "123456",
    message: `feat(hubspot): deploy ${index}`,
    status: "success",
    file_count: 1,
    files: [`src/example-123456/theme/file-${index}.html`],
    ...overrides,
  };
}

async function repoWithDeploys(deploys: DeployRecord[]): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "hsdm-history-"));
  await saveHistory({ deploys }, cwd);
  return cwd;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("historyAction", () => {
  it("warns when the portal has no deploys", async () => {
    const cwd = await repoWithDeploys([deploy(1, { portal_id: "999999" })]);

    await historyAction(account, cwd);

    expect(prompts.warn).toHaveBeenCalledWith("No deploys recorded for example.");
    expect(prompts.select).not.toHaveBeenCalled();
  });

  it("lists one page at a time and can load older deploys", async () => {
    const cwd = await repoWithDeploys(Array.from({ length: 14 }, (_, index) => deploy(index)));
    prompts.select.mockResolvedValueOnce("__more__").mockResolvedValueOnce("__back__");

    await historyAction(account, cwd);

    const firstPage = prompts.select.mock.calls[0]![0];
    expect(stripAnsi(firstPage.message)).toBe("Deploy history · example (10 of 14)");
    expect(firstPage.options).toHaveLength(12); // 10 deploys + show more + back

    const secondPage = prompts.select.mock.calls[1]![0];
    expect(stripAnsi(secondPage.message)).toBe("Deploy history · example (14 of 14)");
    expect(secondPage.options).toHaveLength(15); // 14 deploys + back, no "show more"
  });

  it("shows the files of the selected deploy as a tree", async () => {
    const cwd = await repoWithDeploys([
      deploy(0, {
        message: "feat(hubspot): deploy 2 file(s) to example",
        file_count: 2,
        files: [
          "src/example-123456/theme/modules/hero.module/module.html",
          "src/example-123456/theme/modules/hero.module/fields.json",
        ],
      }),
    ]);
    prompts.select.mockResolvedValueOnce("0").mockResolvedValueOnce("__back__");

    await historyAction(account, cwd);

    const [body, title] = prompts.note.mock.calls[0]!;
    expect(stripAnsi(body)).toContain("feat(hubspot): deploy 2 file(s) to example");
    expect(stripAnsi(body)).toContain("uploaded · 2 file(s) · example (123456)");
    expect(stripAnsi(body)).toContain("└─ hero.module");
    expect(stripAnsi(body)).toContain("├─ module.html");
    expect(stripAnsi(title)).toContain("2026-08-05 23:00:00");
    // The list is shown again after the detail.
    expect(prompts.select).toHaveBeenCalledTimes(2);
  });

  it("leaves the browser when the selection is not a row", async () => {
    const cwd = await repoWithDeploys([deploy(0)]);
    prompts.select.mockResolvedValue("something-unexpected");

    await historyAction(account, cwd);

    // Must not re-prompt in a loop on an unknown value.
    expect(prompts.select).toHaveBeenCalledTimes(1);
    expect(prompts.note).not.toHaveBeenCalled();
  });

  it("labels a partial deploy differently", async () => {
    const cwd = await repoWithDeploys([deploy(0, { status: "partial" })]);
    prompts.select.mockResolvedValueOnce("0").mockResolvedValueOnce("__back__");

    await historyAction(account, cwd);

    expect(stripAnsi(prompts.note.mock.calls[0]![0])).toContain("partial upload");
  });
});
