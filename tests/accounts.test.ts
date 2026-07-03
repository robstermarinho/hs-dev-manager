import { describe, expect, it } from "vitest";
import { parseAccountListOutput, parseConfigYaml, portalKey } from "../src/hs/accounts.js";
import { parseHsVersion } from "../src/hs/version.js";

describe("parseConfigYaml", () => {
  it("parses v8 global config with defaultAccount", () => {
    const accounts = parseConfigYaml(`
defaultAccount: 222
accounts:
  - name: alpha
    accountId: 111
    authType: personalaccesskey
  - name: beta
    accountId: 222
`);
    expect(accounts).toEqual([
      { name: "alpha", accountId: "111", isDefault: false },
      { name: "beta", accountId: "222", isDefault: true },
    ]);
  });

  it("parses legacy portals config", () => {
    const accounts = parseConfigYaml(`
defaultPortal: 999
portals:
  - name: legacy
    portalId: 999
`);
    expect(accounts).toEqual([{ name: "legacy", accountId: "999", isDefault: true }]);
  });

  it("returns empty for invalid or empty yaml", () => {
    expect(parseConfigYaml("")).toEqual([]);
    expect(parseConfigYaml("just a string")).toEqual([]);
    expect(parseConfigYaml("accounts: notalist")).toEqual([]);
  });

  it("skips malformed entries", () => {
    const accounts = parseConfigYaml(`
accounts:
  - name: ok
    accountId: 1
  - accountId: 2
  - name: no-id
`);
    expect(accounts).toEqual([{ name: "ok", accountId: "1", isDefault: false }]);
  });
});

describe("parseAccountListOutput", () => {
  const output = `Default Account
  Source: /Users/x/.hscli/config.yml
  Account: example-theme [standard] (222222)

Accounts:
  Name                                Account ID    Auth Type
  alpha [standard]                   111111         personalaccesskey
  example-theme [standard]                 222222      personalaccesskey
`;

  it("parses table rows, strips [type], detects default", () => {
    expect(parseAccountListOutput(output)).toEqual([
      { name: "alpha", accountId: "111111", isDefault: false },
      { name: "example-theme", accountId: "222222", isDefault: true },
    ]);
  });

  it("returns empty on unexpected output", () => {
    expect(parseAccountListOutput("boom")).toEqual([]);
  });
});

describe("parseHsVersion", () => {
  it("extracts semver", () => {
    expect(parseHsVersion("8.4.0\n")).toBe("8.4.0");
    expect(parseHsVersion("HubSpot CLI 10.2.1")).toBe("10.2.1");
    expect(parseHsVersion("nope")).toBeUndefined();
  });
});

describe("portalKey", () => {
  it("matches sh naming scheme", () => {
    expect(portalKey({ name: "alpha", accountId: "111", isDefault: false })).toBe("alpha-111");
  });
});
