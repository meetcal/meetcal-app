import type { LiftResult } from "@/data/types/athletes";
import {
  mergeWithStoredSession,
  revertRefusedSave,
  sessionsFromAthletes,
  upsertSession,
} from "@/lib/saved-sessions-list";
import { MAX_SAVED_SESSION_ATHLETE_NAMES } from "@/lib/saved-sessions-outbox";
import type { SavedSession } from "@/lib/saved-sessions-store";
import type { Schedule } from "@/types/schedule";

const MEET = "Test Meet" as never;

const session = (overrides: Partial<SavedSession> = {}): SavedSession => ({
  id: "Test-Meet-1-Red",
  meet: MEET,
  sessionNumber: 1,
  platform: "Red",
  weightClass: "71kg",
  startTime: "10:00 AM",
  weighInTime: "8:00 AM",
  date: "2099-06-20",
  ...overrides,
});

describe("upsertSession", () => {
  it("appends a new session without touching the input list", () => {
    const current = [session({ id: "a" })];
    const result = upsertSession(current, session());
    expect(result.isUpdate).toBe(false);
    expect(result.previousSession).toBeUndefined();
    expect(result.nextSessions.map((s) => s.id)).toEqual(["a", "Test-Meet-1-Red"]);
    expect(current).toHaveLength(1);
  });

  it("merges over the stored row in place and remembers the previous version", () => {
    const stored = session({ notes: "keep", athleteNames: ["A"] });
    const result = upsertSession([session({ id: "a" }), stored], session({ athleteNames: ["B"] }));
    expect(result.isUpdate).toBe(true);
    expect(result.previousSession).toBe(stored);
    expect(result.nextSessions[1]).toEqual({ ...stored, athleteNames: ["B"] });
    expect(result.updatedSession).toBe(result.nextSessions[1]);
  });

  it("caps athlete names at the backend limit", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const names = Array.from({ length: MAX_SAVED_SESSION_ATHLETE_NAMES + 5 }, (_, i) => `A${i}`);
    const { updatedSession } = upsertSession([], session({ athleteNames: names }));
    expect(updatedSession.athleteNames).toHaveLength(MAX_SAVED_SESSION_ATHLETE_NAMES);
    warnSpy.mockRestore();
  });
});

describe("revertRefusedSave", () => {
  const refused = session({ notes: "new" });

  it("restores the previous version of an edited row", () => {
    const previous = session({ notes: "old" });
    expect(revertRefusedSave([session({ id: "a" }), refused], refused, previous)).toEqual([
      session({ id: "a" }),
      previous,
    ]);
  });

  it("drops a row the refused save created", () => {
    expect(revertRefusedSave([refused, session({ id: "a" })], refused, undefined)).toEqual([
      session({ id: "a" }),
    ]);
  });

  it("leaves the list alone when the row is gone or has changed since", () => {
    expect(revertRefusedSave([], refused, undefined)).toBeNull();
    expect(revertRefusedSave([session({ notes: "newer" })], refused, undefined)).toBeNull();
  });

  it("matches the refused row regardless of key order", () => {
    // Same fields, different key order (e.g. re-read from storage).
    const reordered = Object.fromEntries(Object.entries(refused).reverse()) as typeof refused;
    expect(revertRefusedSave([reordered], refused, undefined)).toEqual([]);
  });
});

describe("sessionsFromAthletes", () => {
  const schedule = [
    {
      date: "June 20, 2099",
      fullDate: "2099-06-20",
      sessions: [
        {
          id: "s1",
          number: 1,
          startTime: "10:00 AM",
          weighInTime: "8:00 AM",
          platforms: [
            { platform: "Red", weightClass: "71kg", platformStartTime: "11:00 AM" },
            { platform: "Blue", weightClass: "76kg" },
          ],
        },
      ],
    },
  ] as unknown as Schedule;

  const athlete = (name: string, sessionFields?: LiftResult["session"]): LiftResult =>
    ({
      memberId: name,
      name,
      age: 25,
      club: "Club",
      gender: "Women",
      weightClass: "87kg",
      entryTotal: 200,
      adaptive: false,
      session: sessionFields,
    }) as LiftResult;

  it("groups athletes by session and platform, de-duplicating names", () => {
    const result = sessionsFromAthletes(
      [
        athlete("A", { number: 1, platform: "Red" }),
        athlete("B", { number: 1, platform: "Red" }),
        athlete("A", { number: 1, platform: "Red" }),
        athlete("C", { number: 1, platform: "Blue" }),
        athlete("No session"),
      ],
      MEET,
      schedule,
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: "Test-Meet-1-Red",
        weightClass: "71kg",
        startTime: "11:00 AM",
        date: "2099-06-20",
        athleteNames: ["A", "B"],
      }),
      // No platform start time: the session's start time applies.
      expect.objectContaining({
        id: "Test-Meet-1-Blue",
        weightClass: "76kg",
        startTime: "10:00 AM",
        athleteNames: ["C"],
      }),
    ]);
  });

  it("falls back to the athlete's own session fields when the schedule lacks it", () => {
    const [result] = sessionsFromAthletes(
      [athlete("A", { number: 9, platform: "Red", startTime: "1:00 PM", date: "2099-06-21" })],
      MEET,
      [],
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: "Test-Meet-9-Red",
        weightClass: "87kg",
        startTime: "1:00 PM",
        date: "2099-06-21",
        athleteNames: ["A"],
      }),
    );
  });
});

describe("mergeWithStoredSession", () => {
  it("returns a copy when nothing is stored for the id", () => {
    const generated = session({ athleteNames: ["A"] });
    const merged = mergeWithStoredSession(generated, [session({ id: "other" })]);
    expect(merged).toEqual(generated);
    expect(merged).not.toBe(generated);
  });

  it("keeps stored fields, takes new schedule data and unions the names", () => {
    const stored = session({ notes: "keep", startTime: "9:00 AM", athleteNames: ["A", "B"] });
    const generated = session({ startTime: "10:00 AM", athleteNames: ["B", "C"] });
    expect(mergeWithStoredSession(generated, [stored])).toEqual({
      ...stored,
      startTime: "10:00 AM",
      athleteNames: ["A", "B", "C"],
    });
  });
});
