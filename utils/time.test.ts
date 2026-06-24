import { calculateWeighInTime } from "@/utils/time";

describe("calculateWeighInTime", () => {
  beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("subtracts two hours from a 12-hour time", () => {
    expect(calculateWeighInTime("10:00 AM")).toBe("8:00 AM");
    expect(calculateWeighInTime("2:30 PM")).toBe("12:30 PM");
    expect(calculateWeighInTime("12:00 PM")).toBe("10:00 AM");
  });

  it("accepts 24-hour times", () => {
    expect(calculateWeighInTime("14:00")).toBe("12:00 PM");
    expect(calculateWeighInTime("09:15")).toBe("7:15 AM");
  });

  it("wraps around midnight", () => {
    expect(calculateWeighInTime("1:00 AM")).toBe("11:00 PM");
    expect(calculateWeighInTime("12:00 AM")).toBe("10:00 PM");
  });

  it("falls back to 6:00 AM for invalid input", () => {
    expect(calculateWeighInTime("garbage")).toBe("6:00 AM");
    expect(calculateWeighInTime("99:99 AM")).toBe("6:00 AM");
  });
});
