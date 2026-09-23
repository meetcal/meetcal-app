import { isMeetName } from "@/data/types/meet";

describe("isMeetName", () => {
  it("treats any string as a meet name when no allow-list is given", () => {
    expect(isMeetName("Worlds")).toBe(true);
    expect(isMeetName("")).toBe(true);
  });

  it("rejects a missing selection", () => {
    expect(isMeetName(null)).toBe(false);
  });

  it("narrows to the allow-list when one is given", () => {
    const allowed = new Set(["2026 Nationals"]);
    expect(isMeetName("2026 Nationals", allowed)).toBe(true);
    // A meet that has since dropped out of the upcoming window must not pass:
    // saved sessions key off this before routing to a start list.
    expect(isMeetName("2019 Nationals", allowed)).toBe(false);
  });
});
