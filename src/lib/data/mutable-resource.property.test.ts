import * as fc from "fast-check";

import { jsonEqual, stableSerialize } from "@/lib/data/mutable-resource";

function shuffledKeys(value: unknown, order: number[]): unknown {
  if (Array.isArray(value)) return value.map((item) => shuffledKeys(item, order));
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const shuffled = entries
      .map((entry, index) => ({ entry, rank: order[index % Math.max(order.length, 1)] ?? index }))
      .sort((left, right) => left.rank - right.rank)
      .map(({ entry: [key, nested] }) => [key, shuffledKeys(nested, order)] as const);
    return Object.fromEntries(shuffled);
  }
  return value;
}

describe("jsonEqual", () => {
  it("agrees with comparing stable serializations for any JSON values", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.jsonValue(), (left, right) => {
        expect(jsonEqual(left, right)).toBe(stableSerialize(left) === stableSerialize(right));
      }),
    );
  });

  it("ignores key order at every depth", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 1 }), (value, order) => {
        expect(jsonEqual(value, shuffledKeys(value, order))).toBe(true);
      }),
    );
  });

  it("treats a key holding undefined as absent, as serialization does", () => {
    expect(jsonEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(jsonEqual({ a: undefined }, { b: undefined })).toBe(true);
    expect(jsonEqual({ a: 1 }, { b: 1 })).toBe(false);
    expect(jsonEqual([undefined], [null])).toBe(true);
    expect(jsonEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(jsonEqual([1], { 0: 1 })).toBe(false);
    expect(jsonEqual(null, {})).toBe(false);
  });
});
