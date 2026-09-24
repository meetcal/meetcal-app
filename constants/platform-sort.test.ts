import {
  comparePlatforms,
  PLATFORM_SORT_ORDER,
  sortByPlatform,
} from "@/constants/platform-sort";

describe("platform sort", () => {
  it("keeps the known platforms in their fixed order first, then others alphabetically", () => {
    const platforms = ["Zinc", "Gold", "Rogue", "red", "Blue", "Amber", "Stars"];
    expect(sortByPlatform(platforms, (p) => p)).toEqual([
      "red", "Blue", "Stars", "Rogue", "Amber", "Gold", "Zinc",
    ]);
  });

  it("is stable for platforms that compare equal", () => {
    const rows = [
      { platform: "Gold", id: 1 },
      { platform: "gold", id: 2 },
      { platform: "Red", id: 3 },
    ];
    expect(sortByPlatform(rows, (r) => r.platform).map((r) => r.id)).toEqual([3, 1, 2]);
  });

  it("ranks every known platform before any unknown one", () => {
    for (const known of PLATFORM_SORT_ORDER) {
      expect(comparePlatforms(known, "Aaa")).toBeLessThan(0);
      expect(comparePlatforms("Aaa", known)).toBeGreaterThan(0);
    }
    expect(comparePlatforms("Gold", "Gold")).toBe(0);
  });
});
