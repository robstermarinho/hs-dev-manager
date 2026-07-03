import { describe, expect, it } from "vitest";
import { localDirFor, portalScope, remotePathFor } from "../src/paths.js";
import type { HsAccount } from "../src/hs/accounts.js";

const account: HsAccount = { name: "alpha", accountId: "111", isDefault: false };

describe("localDirFor", () => {
  it("builds sh-compatible layout under src/", () => {
    expect(localDirFor(account, "/theme/js", "/proj")).toBe("/proj/src/alpha-111/theme/js");
  });
});

describe("portalScope", () => {
  it("scopes to the portal dir", () => {
    expect(portalScope(account)).toBe("src/alpha-111");
  });
});

describe("remotePathFor", () => {
  it("derives remote path from repo-relative file", () => {
    expect(remotePathFor(account, "src/alpha-111/theme/main.css")).toBe("/theme/main.css");
  });

  it("returns undefined for files outside the portal dir", () => {
    expect(remotePathFor(account, "src/other-9/x.css")).toBeUndefined();
    expect(remotePathFor(account, "README.md")).toBeUndefined();
  });
});
