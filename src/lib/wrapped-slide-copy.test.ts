import {
  accuracyTier,
  attemptIdentity,
  easedCounterValue,
  formatCounterValue,
  pickFunFact,
} from "@/lib/wrapped-slide-copy";

describe("pickFunFact", () => {
  it("picks among the comparisons that count at least one of the thing", () => {
    expect(pickFunFact(1000, () => 0)).toBe("That's 1 grand pianos");
  });

  it("falls back to adult humans when no comparison counts one", () => {
    expect(pickFunFact(0, () => 0)).toBe("That's 0 adult humans");
  });

  it("can pick the last fitting comparison", () => {
    expect(pickFunFact(100, () => 0.999)).toBe("That's 714 iPhones");
  });
});

describe("accuracyTier", () => {
  it.each([
    [80, "ELITE"],
    [79.9, "SOLID"],
    [60, "SOLID"],
    [59.9, "GROWING"],
    [0, "GROWING"],
  ])("rates a %p%% make rate %p", (rate, tier) => {
    expect(accuracyTier(rate)).toBe(tier);
  });
});

describe("attemptIdentity", () => {
  it("names each favorite attempt", () => {
    expect(attemptIdentity("1st").title).toBe("THE OPENER");
    expect(attemptIdentity("2nd").title).toBe("THE BUILDER");
    expect(attemptIdentity("3rd").title).toBe("THE CLOSER");
  });

  it("gives a year with no made attempt the general identity", () => {
    expect(attemptIdentity("—")).toEqual({ title: "THE LIFTER", description: "Every attempt counts." });
  });
});

describe("easedCounterValue", () => {
  it("starts at zero and lands on the target", () => {
    expect(easedCounterValue(0, 1185, 0)).toBe(0);
    expect(easedCounterValue(1, 1185, 0)).toBe(1185);
  });

  it("eases out, covering most of the distance by halfway", () => {
    expect(easedCounterValue(0.5, 100, 0)).toBe(88);
  });

  it("rounds to the counter's decimals", () => {
    expect(easedCounterValue(1, 66.66, 1)).toBe(66.7);
  });
});

describe("formatCounterValue", () => {
  it("groups whole numbers by thousands", () => {
    expect(formatCounterValue(1234567, 0)).toBe("1,234,567");
    expect(formatCounterValue(999, 0)).toBe("999");
  });

  it("shows fixed decimals without grouping", () => {
    expect(formatCounterValue(1234.5, 1)).toBe("1234.5");
  });
});
