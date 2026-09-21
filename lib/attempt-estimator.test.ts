import { calculateEstimates, generateAthleteNotes } from "@/lib/attempt-estimator";
import type { LiftResult, SupabaseLiftResult } from "@/data/types/athletes";
import {
  ATTEMPT_HISTORY_YEARS,
  getHistoryCutoffDate,
} from "@/utils/dateTime";

const athlete = (overrides: Partial<LiftResult>): LiftResult => ({
  memberId: "1",
  name: "Test Athlete",
  age: 25,
  club: "",
  gender: "Men",
  weightClass: "89",
  entryTotal: 0,
  adaptive: false,
  ...overrides,
});

const recentDate = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().split("T")[0];
};

const result = (overrides: Partial<SupabaseLiftResult>): SupabaseLiftResult => ({
  id: 1,
  event_id: "e1",
  meet: "Meet",
  date: recentDate(),
  name: "Test Athlete",
  age: 25,
  body_weight: 88,
  snatch1: null,
  snatch2: null,
  snatch3: null,
  snatch_best: null,
  cj1: null,
  cj2: null,
  cj3: null,
  cj_best: null,
  total: null,
  ...overrides,
});

describe("calculateEstimates", () => {
  it("derives estimates from historical bests (93% opener + jumps)", () => {
    const history = [
      result({
        snatch1: 100,
        snatch2: 104,
        snatch3: 108,
        snatch_best: 108,
        cj1: 120,
        cj2: 125,
        cj3: 130,
        cj_best: 130,
      }),
    ];
    const [estimate] = calculateEstimates(
      [athlete({ name: "Test Athlete" })],
      history,
    );

    expect(estimate.bestSnatch).toBe(108);
    expect(estimate.bestCJ).toBe(130);
    // opener = round(108 * 0.93) = 100, then +4 (1->2), +4 (2->3)
    expect(estimate.snatchEstimates[0]).toBe(Math.round(108 * 0.93));
    expect(estimate.snatchEstimates).toHaveLength(3);
    expect(estimate.averageSnatchIncrease.first).toBe(4);
    expect(estimate.averageSnatchIncrease.second).toBe(4);
  });

  it("falls back to entry total when there is no recent history", () => {
    const [estimate] = calculateEstimates(
      [athlete({ name: "No History", entryTotal: 200 })],
      [],
    );

    expect(estimate.bestSnatch).toBeNull();
    expect(estimate.bestCJ).toBeNull();
    // estimatedTotal = round(200 * 0.93) = 186; snatch opener = round(186 * 0.43)
    const estimatedTotal = Math.round(200 * 0.93);
    expect(estimate.snatchEstimates[0]).toBe(Math.round(estimatedTotal * 0.43));
    expect(estimate.cjEstimates[0]).toBe(Math.round(estimatedTotal * 0.57));
  });

  it("ignores history older than two years", () => {
    const old = result({
      date: "2000-01-01",
      snatch_best: 150,
      cj_best: 180,
    });
    const [estimate] = calculateEstimates(
      [athlete({ name: "Test Athlete", entryTotal: 0 })],
      [old],
    );

    expect(estimate.bestSnatch).toBeNull();
    expect(estimate.snatchEstimates).toHaveLength(0);
  });

  it("matches athletes by normalized name (case/whitespace insensitive)", () => {
    const history = [result({ name: "  test   ATHLETE ", snatch_best: 100 })];
    const [estimate] = calculateEstimates(
      [athlete({ name: "Test Athlete" })],
      history,
    );
    expect(estimate.bestSnatch).toBe(100);
  });

  it("computes attempts-out ordering across athletes by opener weight", () => {
    const history = [
      result({ name: "Light", snatch_best: 80 }),
      result({ name: "Heavy", snatch_best: 120 }),
    ];
    const estimates = calculateEstimates(
      [athlete({ name: "Light" }), athlete({ name: "Heavy" })],
      history,
    );
    const light = estimates.find((e) => e.athleteName === "Light")!;
    const heavy = estimates.find((e) => e.athleteName === "Heavy")!;
    // Lighter opener lifts first -> zero attempts out before them.
    expect(light.snatchAttemptsOut).toBe(0);
    // Heavier athlete has the lighter athlete's three attempts ahead.
    expect(heavy.snatchAttemptsOut).toBeGreaterThan(0);
  });
});

describe("opener make rates", () => {
  it("counts missed openers in the denominator", () => {
    // Misses are stored as negative kilos. Two made openers out of four taken
    // is 50%, not 100%.
    const history = [
      result({ snatch1: -100, cj1: -120 }),
      result({ snatch1: 102, cj1: 122 }),
      result({ snatch1: -105, cj1: -125 }),
      result({ snatch1: 105, cj1: 125 }),
    ];
    const [estimate] = calculateEstimates(
      [athlete({ name: "Test Athlete" })],
      history,
    );
    expect(estimate.snatchMakeRate).toBeCloseTo(0.5);
    expect(estimate.cjMakeRate).toBeCloseTo(0.5);
  });

  it("reports 0 when every opener was missed", () => {
    const [estimate] = calculateEstimates(
      [athlete({ name: "Test Athlete" })],
      [result({ snatch1: -100, cj1: -120 })],
    );
    expect(estimate.snatchMakeRate).toBe(0);
    expect(estimate.cjMakeRate).toBe(0);
  });

  it("ignores meets where the opener was never taken", () => {
    const [estimate] = calculateEstimates(
      [athlete({ name: "Test Athlete" })],
      [result({ snatch1: null, cj1: 0 }), result({ snatch1: 100, cj1: 120 })],
    );
    expect(estimate.snatchMakeRate).toBe(1);
    expect(estimate.cjMakeRate).toBe(1);
  });
});

describe("generateAthleteNotes", () => {
  it("flags athletes with no historical data", () => {
    const [estimate] = calculateEstimates(
      [athlete({ name: "No History", entryTotal: 200 })],
      [],
    );
    expect(generateAthleteNotes(estimate)).toContain(
      "No data within the past 2 years",
    );
  });

  it("summarizes jumps and make rates when history exists", () => {
    const history = [
      result({
        snatch1: 100,
        snatch2: 104,
        snatch3: 108,
        snatch_best: 108,
        cj1: 120,
        cj2: 125,
        cj3: 130,
        cj_best: 130,
      }),
    ];
    const [estimate] = calculateEstimates(
      [athlete({ name: "Test Athlete" })],
      history,
    );
    const notes = generateAthleteNotes(estimate);
    expect(notes).toContain("Snatch");
    expect(notes).toContain("Clean & Jerk");
    expect(notes).toContain("%");
  });
});

describe("history window", () => {
  const lifted = (date: string): SupabaseLiftResult =>
    result({
      date,
      snatch1: 100,
      snatch_best: 100,
      cj1: 120,
      cj_best: 120,
    });

  const bestsFor = (history: SupabaseLiftResult[]) => {
    const [estimate] = calculateEstimates(
      [athlete({ name: "Test Athlete" })],
      history,
    );
    return estimate;
  };

  it("drops results older than the shared two-year cutoff", () => {
    const old = new Date();
    old.setUTCFullYear(old.getUTCFullYear() - 3);
    const estimate = bestsFor([lifted(old.toISOString().split("T")[0])]);
    expect(estimate.snatchEstimates).toEqual([]);
    expect(estimate.cjEstimates).toEqual([]);
  });

  it("keeps a result dated exactly on the cutoff", () => {
    const cutoff = getHistoryCutoffDate(ATTEMPT_HISTORY_YEARS);
    expect(bestsFor([lifted(cutoff)]).snatchEstimates.length).toBeGreaterThan(0);
  });

  it("reads a timestamped date as its own calendar day, not the device's", () => {
    // A bare `new Date("...T00:00:00")` parses device-local, so west of UTC
    // `toISOString()` would hand back the previous day and push a result that
    // lands exactly on the cutoff out of the window.
    const cutoff = getHistoryCutoffDate(ATTEMPT_HISTORY_YEARS);
    expect(
      bestsFor([lifted(`${cutoff}T00:00:00`)]).snatchEstimates.length,
    ).toBeGreaterThan(0);
  });
});
