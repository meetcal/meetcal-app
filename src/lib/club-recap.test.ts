import { formatMakeRate } from "@/lib/club-recap";

describe("formatMakeRate", () => {
  it("rounds the rate to a whole percent", () => {
    expect(formatMakeRate(66.6)).toBe("67%");
    expect(formatMakeRate(66.4)).toBe("66%");
    expect(formatMakeRate(100)).toBe("100%");
  });

  it("shows a rate missing from an older cached answer as 0%", () => {
    expect(formatMakeRate(undefined)).toBe("0%");
  });
});
