import { describe, expect, it } from "vitest";
import { hubspotPortalUrls, localDirFor, portalScope, remotePathFor } from "../src/paths.js";
import type { HsAccount } from "../src/hs/accounts.js";

const account: HsAccount = { name: "alpha", accountId: "111", isDefault: false };

describe("localDirFor", () => {
  it("builds sh-compatible layout under src/", () => {
    expect(localDirFor(account, "/theme/js", "/proj")).toBe("/proj/src/alpha-111/theme/js");
  });

  it("rejects remote paths that escape the portal directory", () => {
    expect(() => localDirFor(account, "/../../outside", "/proj")).toThrow("escapes the portal directory");
  });
});

describe("portalScope", () => {
  it("scopes to the portal dir", () => {
    expect(portalScope(account)).toBe("src/alpha-111");
  });
});

describe("hubspotPortalUrls", () => {
  it("builds portal-scoped links for the HubSpot app", () => {
    expect(hubspotPortalUrls(account)).toEqual({
      designManager: "https://app.hubspot.com/design-manager/111",
      websites: "https://app.hubspot.com/website/111/pages/site",
      hubdb: "https://app.hubspot.com/hubdb/111",
      settings: "https://app.hubspot.com/settings/111",
      files: "https://app.hubspot.com/files/111",
    });
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

  it("accepts Git-style and Windows-style separators", () => {
    expect(remotePathFor(account, "src\\alpha-111\\theme\\main.css")).toBe("/theme/main.css");
  });
});
