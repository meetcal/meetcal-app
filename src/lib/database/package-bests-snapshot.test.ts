import { namesWithChangedPackageData } from "@/lib/database/package-bests-snapshot";

describe("namesWithChangedPackageData", () => {
  const row = (name: string, total: number) => ({ name, date: "2026-10-10", total }) as any;
  const bests = (total: number) => ({ snatch_best: 90, cj_best: total - 90, total });

  it("names athletes with new, changed or removed result rows and changed year bests", () => {
    const changed = namesWithChangedPackageData({
      results: [row("Same", 200), row("Changed", 190), row("New", 150)],
      storedResults: [row("Same", 200), row("Changed", 180), row("Removed", 170)],
      yearBests: { "Same Best": bests(200), "New Best": bests(210) },
      storedBests: { "same best": { bests: bests(200) }, "New Best": { bests: bests(205) } },
    });
    expect([...changed].sort()).toEqual(["changed", "new", "new best", "removed"]);
  });

  it("ignores a best that only left the window", () => {
    const changed = namesWithChangedPackageData({
      results: [],
      storedResults: [],
      yearBests: {},
      storedBests: { Gone: { bests: bests(200) } },
    });
    expect(changed.size).toBe(0);
  });
});
