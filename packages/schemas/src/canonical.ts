/**
 * One canonical JSON serialisation, used everywhere a manifest is hashed.
 *
 * Build plan section 7: "Exact UTF-8 bytes and one canonical JSON specification
 * for off-chain manifests." The rules, fixed here so they cannot drift:
 *
 *   - object keys sorted by UTF-16 code unit (JavaScript's default sort)
 *   - no insignificant whitespace
 *   - numbers must be finite; integers serialise without a decimal point
 *   - `undefined` and functions are rejected rather than silently dropped,
 *     because a field that vanishes changes the digest without changing the
 *     thing the digest is supposed to describe
 *   - arrays keep their order, which is significant
 *
 * The matching Python implementation is `canonical_json` in
 * `packages/schemas/python/gpuvtec_ids.py`.
 */

import { keccak256, sha256, toHex, type Hex } from "viem";

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

export class CanonicalJsonError extends Error {}

export function canonicalJson(value: CanonicalValue, path = "$"): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";

    case "number": {
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError(`${path}: ${value} is not finite`);
      }
      // JSON.stringify already renders integers without a decimal point and
      // uses the shortest round-tripping form for fractions.
      return JSON.stringify(value);
    }

    case "string":
      return JSON.stringify(value);

    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item, i) => canonicalJson(item, `${path}[${i}]`)).join(",")}]`;
      }
      const record = value as Record<string, CanonicalValue>;
      const keys = Object.keys(record).sort();
      const parts = keys.map((key) => {
        const inner = record[key];
        if (inner === undefined) {
          throw new CanonicalJsonError(
            `${path}.${key}: undefined. Omit the key or write null - a vanishing ` +
              "field changes the digest without changing what it describes.",
          );
        }
        return `${JSON.stringify(key)}:${canonicalJson(inner, `${path}.${key}`)}`;
      });
      return `{${parts.join(",")}}`;
    }

    default:
      throw new CanonicalJsonError(`${path}: ${typeof value} cannot be serialised`);
  }
}

/** SHA-256 of the canonical bytes. Section 7: "SHA-256 for artifact file digests." */
export function manifestDigest(value: CanonicalValue): Hex {
  return sha256(toHex(new TextEncoder().encode(canonicalJson(value))));
}

/** keccak256 of the canonical bytes, for values that feed contract identifiers. */
export function manifestKeccak(value: CanonicalValue): Hex {
  return keccak256(toHex(new TextEncoder().encode(canonicalJson(value))));
}
