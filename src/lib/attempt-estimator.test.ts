import {
  type AthleteAttemptEstimate,
  calculateEstimates,
  formatAttemptsOut,
  generateAthleteNotes,
  sortEstimatesByAttemptsOut,
} from "@/lib/attempt-estimator";
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

  it("matches a roster name and result rows written in different Unicode forms (#268)", () => {
    // The server matches names across NFC and NFD and returns each row with
    // its stored spelling; the roster can carry the other form.
    const nfc = "José Núñez".normalize("NFC");
    const history = [result({ name: nfc, snatch_best: 100, cj_best: 120 })];
    const [estimate] = calculateEstimates(
      [athlete({ name: nfc.normalize("NFD") })],
      history,
    );
    expect(estimate.bestSnatch).toBe(100);
    expect(estimate.bestCJ).toBe(120);
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

describe("attempts out", () => {
  // One history row with every attempt made: the opener estimate is
  // round(best * 0.93) and the jumps are that row's own jumps.
  const planned = (name: string, opener: number, second: number, third: number) =>
    result({
      name,
      snatch1: opener,
      snatch2: second,
      snatch3: third,
      snatch_best: Math.round(opener / 0.93),
    });

  const byName = (estimates: AthleteAttemptEstimate[], name: string) =>
    estimates.find((estimate) => estimate.athleteName === name)!;

  it("lifts a lower attempt number first at the same weight", () => {
    // A plans 80 / 83 / 86 and B opens at 83. On the platform B's opener goes
    // before A's second attempt, so only A's opener is ahead of B. Sorting by
    // weight alone put A2 first and counted A1, A2 and a follow-on: 3.
    const estimates = calculateEstimates(
      [athlete({ name: "A" }), athlete({ name: "B" })],
      [planned("A", 80, 83, 86), planned("B", 83, 86, 89)],
    );
    expect(byName(estimates, "A").snatchEstimates).toEqual([80, 83, 86]);
    expect(byName(estimates, "B").snatchEstimates[0]).toBe(83);
    expect(byName(estimates, "A").snatchAttemptsOut).toBe(0);
    expect(byName(estimates, "B").snatchAttemptsOut).toBe(1);
  });

  it("keeps start-list order when weight and attempt number both tie", () => {
    const history = [planned("First", 80, 83, 86), planned("Second", 80, 83, 86)];
    const forward = calculateEstimates(
      [athlete({ name: "First" }), athlete({ name: "Second" })],
      history,
    );
    expect(byName(forward, "First").snatchAttemptsOut).toBe(0);
    expect(byName(forward, "Second").snatchAttemptsOut).toBe(1);

    const reversed = calculateEstimates(
      [athlete({ name: "Second" }), athlete({ name: "First" })],
      history,
    );
    expect(byName(reversed, "Second").snatchAttemptsOut).toBe(0);
    expect(byName(reversed, "First").snatchAttemptsOut).toBe(1);
  });

  it("counts an athlete following themselves as two attempts", () => {
    // Light's 80 / 83 / 86 all come before Heavy's 100 opener, back to back:
    // 1 + 2 + 2.
    const estimates = calculateEstimates(
      [athlete({ name: "Light" }), athlete({ name: "Heavy" })],
      [planned("Light", 80, 83, 86), planned("Heavy", 100, 103, 106)],
    );
    expect(byName(estimates, "Heavy").snatchAttemptsOut).toBe(5);
  });

  it("is unknown, not zero, for an athlete with no estimated opener", () => {
    const estimates = calculateEstimates(
      [athlete({ name: "Known" }), athlete({ name: "Unknown", entryTotal: 0 })],
      [planned("Known", 80, 83, 86)],
    );
    expect(byName(estimates, "Unknown").snatchAttemptsOut).toBeNull();
    expect(byName(estimates, "Unknown").cjAttemptsOut).toBeNull();
    expect(byName(estimates, "Known").snatchAttemptsOut).toBe(0);
    // No C&J history and no entry total: unknown for the C&J only.
    expect(byName(estimates, "Known").cjAttemptsOut).toBeNull();
  });

  it("tells two athletes with the same name apart", () => {
    const estimates = calculateEstimates(
      [
        athlete({ memberId: "1", name: "Sam Lee", entryTotal: 100 }),
        athlete({ memberId: "2", name: "Sam Lee", entryTotal: 300 }),
      ],
      [],
    );
    // Keyed by name, both would find the lighter Sam's opener and show 0.
    // The heavier Sam has the lighter one's three attempts ahead, back to
    // back: 1 + 2 + 2.
    expect(estimates.map((estimate) => estimate.snatchAttemptsOut)).toEqual([0, 5]);
  });
});

describe("sortEstimatesByAttemptsOut", () => {
  const estimate = (id: string, snatchAttemptsOut: number | null) =>
    ({ id, snatchAttemptsOut }) as AthleteAttemptEstimate;

  it("orders soonest first and puts unknown counts last, keeping ties stable", () => {
    const sorted = sortEstimatesByAttemptsOut([
      estimate("unknown-1", null),
      estimate("late", 6),
      estimate("first", 0),
      estimate("unknown-2", null),
      estimate("tie-a", 3),
      estimate("tie-b", 3),
    ]);
    expect(sorted.map((e) => e.id)).toEqual([
      "first",
      "tie-a",
      "tie-b",
      "late",
      "unknown-1",
      "unknown-2",
    ]);
  });
});

describe("formatAttemptsOut", () => {
  it("labels an unknown count with a dash", () => {
    expect(formatAttemptsOut(null)).toBe("—");
    expect(formatAttemptsOut(0)).toBe("0 attempts out");
    expect(formatAttemptsOut(1)).toBe("1 attempt out");
    expect(formatAttemptsOut(4)).toBe("4 attempts out");
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
