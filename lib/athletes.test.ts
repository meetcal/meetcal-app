import type { LiftResult } from "@/data/types/athletes";
import {
  filterSessionAthletes,
  isLiftResult,
  maxSuccessfulAttempt,
  normalizeAthleteName,
  normalizePlatformKey,
} from "@/lib/athletes";

const athlete = (
  name: string,
  session?: LiftResult["session"],
): LiftResult => ({
  memberId: name,
  name,
  age: 25,
  club: "Club",
  gender: "M",
  weightClass: "81kg",
  entryTotal: 200,
  adaptive: false,
  session,
});

describe("normalizeAthleteName", () => {
  it("trims, lowercases and collapses inner whitespace", () => {
    expect(normalizeAthleteName("  Mary  Jane   Doe ")).toBe("mary jane doe");
  });

  it("maps missing names to the empty string", () => {
    expect(normalizeAthleteName(null)).toBe("");
    expect(normalizeAthleteName(undefined)).toBe("");
  });
});

describe("normalizePlatformKey", () => {
  it("trims and lowercases", () => {
    expect(normalizePlatformKey(" Red ")).toBe("red");
  });

  it("maps missing platforms to the empty string", () => {
    expect(normalizePlatformKey(undefined)).toBe("");
  });
});

describe("filterSessionAthletes", () => {
  const athletes = [
    athlete("a", { number: 1, platform: "Red" }),
    athlete("b", { number: 1, platform: "Blue" }),
    athlete("c", { number: 2, platform: "Red" }),
    athlete("d"),
  ];

  it("keeps only the athletes on the given session and platform", () => {
    expect(filterSessionAthletes(athletes, 1, "Red").map((a) => a.name)).toEqual(
      ["a"],
    );
  });

  it("matches the platform case-insensitively and ignoring padding", () => {
    expect(
      filterSessionAthletes(athletes, 1, " red ").map((a) => a.name),
    ).toEqual(["a"]);
  });

  it("drops athletes with no session assignment", () => {
    expect(filterSessionAthletes(athletes, 3, "Red")).toEqual([]);
  });
});

describe("maxSuccessfulAttempt", () => {
  it("returns the heaviest made lift, ignoring misses and gaps", () => {
    expect(maxSuccessfulAttempt([100, -105, null, 103, undefined])).toBe(103);
  });

  it("returns null when nothing was made", () => {
    expect(maxSuccessfulAttempt([-100, null, undefined])).toBeNull();
    expect(maxSuccessfulAttempt([])).toBeNull();
  });
});

describe("isLiftResult", () => {
  it("accepts athletes with and without session metadata", () => {
    expect(isLiftResult(athlete("Jane"))).toBe(true);
    expect(isLiftResult(athlete("Jane", { number: 1, platform: "Red" }))).toBe(true);
  });

  it.each([
    null,
    "Jane",
    { ...athlete("Jane"), name: 12 },
    { ...athlete("Jane"), name: " " },
    { ...athlete("Jane"), entryTotal: Infinity },
    { ...athlete("Jane"), session: { number: "1", platform: "Red" } },
    { ...athlete("Jane"), session: { number: 1, platform: 12 } },
    { ...athlete("Jane"), session: { number: 1, platform: "Red", date: {} } },
  ])("rejects malformed rows %p", (row) => {
    expect(isLiftResult(row)).toBe(false);
  });
});
