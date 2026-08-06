import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runHs: vi.fn() }));

vi.mock("../src/hs/runner.js", () => ({ runHs: mocks.runHs }));

import { fetchRemoteInventory, MAX_PAGES, PAGE_SIZE } from "../src/hs/remote-inventory.js";

function page(entries: { path: string; updated: number }[], total: number) {
  return { ok: true, exitCode: 0, stdout: JSON.stringify({ total, objects: entries }), stderr: "" };
}

const failed = { ok: false, exitCode: 1, stdout: "", stderr: "403" };

/** Answer per endpoint, since both listings are requested in parallel. */
function respond(handlers: { templates: unknown[]; widgets: unknown[] }) {
  const queues = { templates: [...handlers.templates], widgets: [...handlers.widgets] };
  return (args: string[]) => {
    const endpoint = args[1]?.includes("custom-widgets") ? "widgets" : "templates";
    return queues[endpoint].shift() ?? page([], 0);
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchRemoteInventory", () => {
  it("merges templates and modules, normalizing their paths", async () => {
    mocks.runHs.mockImplementation(
      respond({
        templates: [page([{ path: "theme/main.css", updated: 10 }], 1)],
        widgets: [page([{ path: "/theme/modules/hero", updated: 20 }], 1)],
      })
    );

    await expect(fetchRemoteInventory("123456")).resolves.toEqual([
      { path: "/theme/main.css", updated: 10, kind: "file" },
      { path: "/theme/modules/hero.module", updated: 20, kind: "module" },
    ]);
  });

  it("pages until it has the whole listing", async () => {
    const first = Array.from({ length: 2 }, (_, index) => ({ path: `a-${index}.css`, updated: index }));
    const second = [{ path: "b.css", updated: 9 }];
    mocks.runHs.mockImplementation(
      respond({ templates: [page(first, 3), page(second, 3)], widgets: [page([], 0)] })
    );

    const items = await fetchRemoteInventory("123456");

    expect(items).toHaveLength(3);
    // The second request asks for what the first did not return.
    const queries = mocks.runHs.mock.calls.map(([args]) => args[1] as string);
    expect(queries[0]).toContain(`limit=${PAGE_SIZE}&offset=0`);
    expect(queries.some((query) => query.includes("offset=2"))).toBe(true);
  });

  it("is undefined when a listing request fails", async () => {
    mocks.runHs.mockImplementation(
      respond({ templates: [failed], widgets: [page([{ path: "/m/x", updated: 1 }], 1)] })
    );

    await expect(fetchRemoteInventory("123456")).resolves.toBeUndefined();
  });

  it("is undefined when the modules listing fails, rather than reporting files only", async () => {
    // Half an inventory would make every module look unchanged.
    mocks.runHs.mockImplementation(
      respond({ templates: [page([{ path: "a.css", updated: 1 }], 1)], widgets: [failed] })
    );

    await expect(fetchRemoteInventory("123456")).resolves.toBeUndefined();
  });

  it("is undefined when the response is not a listing", async () => {
    mocks.runHs.mockResolvedValue({ ok: true, exitCode: 0, stdout: "<html>404</html>", stderr: "" });

    await expect(fetchRemoteInventory("123456")).resolves.toBeUndefined();
  });

  it("gives up rather than returning a truncated inventory", async () => {
    // Always claims more is coming: paging can never complete.
    mocks.runHs.mockImplementation(() => page([{ path: "a.css", updated: 1 }], 1_000_000));

    await expect(fetchRemoteInventory("123456")).resolves.toBeUndefined();
    expect(mocks.runHs).toHaveBeenCalledTimes(MAX_PAGES * 2);
  });

  it("accepts a genuinely empty portal", async () => {
    mocks.runHs.mockImplementation(() => page([], 0));

    await expect(fetchRemoteInventory("123456")).resolves.toEqual([]);
  });
});
