import { describe, expect, it } from "vitest";
import { canonicalJson, isJsonAsset, isJsonNoise } from "../src/json-noise.js";

describe("canonicalJson", () => {
  it("sorts object keys and ignores formatting", () => {
    expect(canonicalJson('{ "b" : 1, "a" : 2 }')).toBe('{"a":2,"b":1}');
    expect(canonicalJson('{"a":{"z":1,"y":2}}')).toBe('{"a":{"y":2,"z":1}}');
  });

  it("keeps array order, which is meaningful in fields.json", () => {
    expect(canonicalJson('[{"id":"a"},{"id":"b"}]')).toBe('[{"id":"a"},{"id":"b"}]');
  });

  it("is undefined for anything that is not JSON", () => {
    expect(canonicalJson("{ not json")).toBeUndefined();
  });
});

describe("isJsonNoise", () => {
  const values: Record<string, unknown> = { display_width: null, type: "text" };
  const field = (keys: string[]): string =>
    JSON.stringify([Object.fromEntries(keys.map((key) => [key, values[key]]))], null, 2);

  it("recognizes a pure key reorder, the way HubSpot re-serializes fields.json", () => {
    expect(isJsonNoise(field(["display_width", "type"]), field(["type", "display_width"]))).toBe(true);
  });

  it("keeps a real value change", () => {
    expect(isJsonNoise('{"type":"text"}', '{"type":"richtext"}')).toBe(false);
  });

  it("keeps a reordered array, which changes the field order in the editor", () => {
    expect(isJsonNoise('[{"id":"a"},{"id":"b"}]', '[{"id":"b"},{"id":"a"}]')).toBe(false);
  });

  it("keeps an added or removed key", () => {
    expect(isJsonNoise('{"a":1}', '{"a":1,"b":2}')).toBe(false);
    expect(isJsonNoise('{"a":1,"b":2}', '{"a":1}')).toBe(false);
  });

  it("reports identical bytes as no change rather than as noise", () => {
    expect(isJsonNoise('{"a":1}', '{"a":1}')).toBe(false);
  });

  it("never treats unparseable content as equal", () => {
    expect(isJsonNoise("{ broken", "{ broken too")).toBe(false);
    expect(isJsonNoise('{"a":1}', "not json")).toBe(false);
  });
});

describe("isJsonAsset", () => {
  it("matches JSON files regardless of case", () => {
    expect(isJsonAsset("modules/hero.module/fields.json")).toBe(true);
    expect(isJsonAsset("theme/Theme.JSON")).toBe(true);
    expect(isJsonAsset("modules/hero.module/module.html")).toBe(false);
  });
});
