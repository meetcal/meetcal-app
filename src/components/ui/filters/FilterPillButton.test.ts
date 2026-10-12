import { getPillAccessibilityLabel } from "./FilterPillButton";
import type { PillFilterConfig } from "./FilterPillTypes";

jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));

const gender: PillFilterConfig = {
  id: "gender",
  label: "Gender",
  value: "",
  options: [
    { value: "M", label: "Men" },
    { value: "F", label: "Women" },
  ],
  allOptionLabel: "All Genders",
};

describe("getPillAccessibilityLabel", () => {
  it("announces the filter and the chosen option's label", () => {
    expect(getPillAccessibilityLabel({ ...gender, value: "F" })).toBe(
      "Filter by Gender, Women",
    );
  });

  it("announces the all option when nothing is chosen", () => {
    expect(getPillAccessibilityLabel(gender)).toBe("Filter by Gender, All Genders");
    expect(
      getPillAccessibilityLabel({ ...gender, allOptionLabel: undefined }),
    ).toBe("Filter by Gender, All");
  });

  it("falls back to the raw value when it is not one of the options", () => {
    expect(getPillAccessibilityLabel({ ...gender, value: "X" })).toBe(
      "Filter by Gender, X",
    );
  });
});
