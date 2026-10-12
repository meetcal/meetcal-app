import type { SupabaseBests } from "@/data/types/athletes";
import { sortSessionAthletes } from "@/lib/session-athlete-sort";

const athletes = [
  { name: "No History", entryTotal: 200 },
  { name: "Strong Snatcher", entryTotal: 180 },
  { name: "Steady", entryTotal: 170 },
  { name: "Bombed", entryTotal: 160 },
];

const bests: Record<string, SupabaseBests> = {
  "Strong Snatcher": { snatch_best: 120, cj_best: 140, total: 260 },
  Steady: { snatch_best: 100, cj_best: null, total: 230 },
  Bombed: { snatch_best: 0, cj_best: 0, total: 0 },
};

const names = (list: { name: string }[]) => list.map((a) => a.name);

describe("sortSessionAthletes", () => {
  it("does not rank an athlete with no best by their entry total", () => {
    expect(names(sortSessionAthletes(athletes, bests, "snatch", "desc"))).toEqual([
      "Strong Snatcher",
      "Steady",
      "No History",
      "Bombed",
    ]);
  });

  it("keeps athletes with no best last when sorting low to high", () => {
    expect(names(sortSessionAthletes(athletes, bests, "snatch", "asc"))).toEqual([
      "Steady",
      "Strong Snatcher",
      "No History",
      "Bombed",
    ]);
  });

  it("treats a missing single lift as no best for that sort", () => {
    expect(names(sortSessionAthletes(athletes, bests, "cj", "desc"))).toEqual([
      "Strong Snatcher",
      "No History",
      "Steady",
      "Bombed",
    ]);
    expect(names(sortSessionAthletes(athletes, bests, "total", "asc"))).toEqual([
      "Steady",
      "Strong Snatcher",
      "No History",
      "Bombed",
    ]);
  });

  it("sorts by entry total in both directions", () => {
    expect(names(sortSessionAthletes(athletes, {}, "entryTotal", "asc"))).toEqual([
      "Bombed",
      "Steady",
      "Strong Snatcher",
      "No History",
    ]);
    expect(names(sortSessionAthletes(athletes, {}, "entryTotal", "desc"))).toEqual(
      names(athletes),
    );
  });

  it("does not mutate its input", () => {
    const input = [...athletes];
    sortSessionAthletes(input, bests, "snatch", "asc");
    expect(input).toEqual(athletes);
  });
});
