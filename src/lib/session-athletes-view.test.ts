import type { LiftResult } from "@/data/types/athletes";
import {
  SESSION_SORT_OPTIONS,
  sessionSortLabel,
  toSessionAthletesByPlatform,
} from "@/lib/session-athletes-view";

function lifter(name: string, entryTotal: number): LiftResult {
  return {
    memberId: name,
    name,
    age: 25,
    club: "Club",
    gender: "Male",
    weightClass: "89",
    entryTotal,
    adaptive: false,
  };
}

describe("toSessionAthletesByPlatform", () => {
  it("lists the platform's athletes by entry total, high to low, without mutating the input", () => {
    const athletes = [lifter("Low", 150), lifter("High", 250), lifter("Mid", 200)];
    const byPlatform = toSessionAthletesByPlatform("Red", athletes);
    expect(Object.keys(byPlatform)).toEqual(["Red"]);
    expect(byPlatform.Red.map((a) => a.name)).toEqual(["High", "Mid", "Low"]);
    expect(athletes.map((a) => a.name)).toEqual(["Low", "High", "Mid"]);
    expect(byPlatform.Red[0]).toEqual({
      name: "High",
      age: 25,
      club: "Club",
      entryTotal: 250,
      weightClass: "89",
    });
  });
});

describe("session sort labels", () => {
  it("offers both directions of every sort key, and names each key", () => {
    expect(SESSION_SORT_OPTIONS).toHaveLength(8);
    for (const key of ["entryTotal", "snatch", "cj", "total"] as const) {
      const directions = SESSION_SORT_OPTIONS.filter((o) => o.key === key).map((o) => o.direction);
      expect(directions).toEqual(["desc", "asc"]);
    }
    expect(sessionSortLabel("entryTotal")).toBe("Entry Total");
    expect(sessionSortLabel("snatch")).toBe("Best Snatch");
    expect(sessionSortLabel("cj")).toBe("Best CJ");
    expect(sessionSortLabel("total")).toBe("Best Total");
  });
});
