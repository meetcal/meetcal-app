import { formatReferenceKg, MISSING_REFERENCE_VALUE } from "./reference-values";

describe("formatReferenceKg", () => {
  it("shows a set record or standard in kilograms", () => {
    expect(formatReferenceKg(184)).toBe("184kg");
    expect(formatReferenceKg(102.5)).toBe("102.5kg");
  });

  // The reference tables answer 0 for "no record set / no standard" (every
  // U15 B standard, unset masters records) and null for a lift the source
  // left out. Neither is a weight anyone has to beat.
  it.each([0, -1, null, undefined, Number.NaN, Number.POSITIVE_INFINITY])(
    "shows %p as missing",
    (value) => {
      expect(formatReferenceKg(value)).toBe(MISSING_REFERENCE_VALUE);
    },
  );

  it("uses an em dash for a missing value", () => {
    expect(MISSING_REFERENCE_VALUE).toBe("—");
  });
});
