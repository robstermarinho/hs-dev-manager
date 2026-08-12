/**
 * HubSpot serializes JSON assets (module `fields.json` above all) without a
 * stable key order, so two downloads of an untouched module differ byte for byte
 * while meaning exactly the same thing. Those diffs drown the real ones in the
 * post-fetch review, so they are detected and dropped.
 *
 * Only key order inside objects is treated as noise: array order is meaningful
 * in `fields.json` (it is the field order shown in the editor) and is preserved.
 */

/** Recursively sort object keys; arrays keep their order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Key-order- and whitespace-independent form of a JSON document. Undefined when
 * the text is not JSON at all, so callers never treat unparseable content as
 * equal to anything.
 */
export function canonicalJson(text: string): string | undefined {
  try {
    return JSON.stringify(canonicalize(JSON.parse(text) as unknown));
  } catch {
    return undefined;
  }
}

/** True when two JSON documents differ only in key order or formatting. */
export function isJsonNoise(before: string, after: string): boolean {
  if (before === after) return false; // identical bytes are not a change at all
  const a = canonicalJson(before);
  if (a === undefined) return false;
  const b = canonicalJson(after);
  return b !== undefined && a === b;
}

/** Whether a path is a JSON asset worth checking for serializer noise. */
export function isJsonAsset(path: string): boolean {
  return path.toLowerCase().endsWith(".json");
}
