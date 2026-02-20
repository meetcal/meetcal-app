import { resolveAthleteResultsMeetScope } from "@/app/shared-screens/athlete-results-scope";

describe("resolveAthleteResultsMeetScope", () => {
  it("prefers route meet over selectedMeet context", () => {
    const result = resolveAthleteResultsMeetScope(
      "Route Meet",
      "Context Meet" as any,
    );
    expect(result).toBe("Route Meet");
  });

  it("falls back to selectedMeet when route meet is missing", () => {
    const result = resolveAthleteResultsMeetScope(undefined, "Context Meet" as any);
    expect(result).toBe("Context Meet");
  });

  it("handles array route param format", () => {
    const result = resolveAthleteResultsMeetScope(
      ["Array Meet"],
      "Context Meet" as any,
    );
    expect(result).toBe("Array Meet");
  });
});
