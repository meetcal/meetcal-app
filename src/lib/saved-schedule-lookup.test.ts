import type { MeetName } from "@/data/types/meet";
import {
  applyScheduleTimes,
  buildSessionScheduleLookup,
  savedScheduleMeet,
  withScheduleTimes,
} from "@/lib/saved-schedule-lookup";
import type { SavedSession } from "@/lib/saved-sessions-store";
import type { Schedule } from "@/types/schedule";

const ALLOWED = new Set(["Meet A", "Meet B"]);

describe("savedScheduleMeet", () => {
  it("is the selected meet only when something is saved for it", () => {
    const saved = [{ meet: "Meet A" }, { meet: "Meet B" }];
    expect(savedScheduleMeet(saved, "Meet A" as MeetName, ALLOWED)).toBe("Meet A");
    expect(savedScheduleMeet([{ meet: "Meet B" }], "Meet A" as MeetName, ALLOWED)).toBeNull();
  });

  it("is null with no selection or a meet outside the allowed list", () => {
    const saved = [{ meet: "Meet Z" }];
    expect(savedScheduleMeet(saved, null, ALLOWED)).toBeNull();
    expect(savedScheduleMeet(saved, "Meet Z" as MeetName, ALLOWED)).toBeNull();
  });
});

describe("buildSessionScheduleLookup", () => {
  const schedule = [
    {
      date: "Saturday, June 20",
      fullDate: "2099-06-20",
      sessions: [
        {
          id: "s-1",
          number: 1,
          startTime: "9:00 AM",
          weighInTime: "7:00 AM",
          platforms: [
            { platform: "Red", weightClass: "71kg", platformStartTime: "10:00 AM" },
            // No start field: a schedule cached in an older shape.
            { platform: "Blue Team", weightClass: "76kg" },
          ],
        },
        {
          id: "s-2",
          number: 2,
          startTime: "",
          weighInTime: "",
          platforms: [{ platform: "Red", weightClass: "81kg", platformStartTime: "" }],
        },
      ],
    },
  ] as unknown as Schedule;

  it("keys rows by session and platform, preferring the platform start time", () => {
    const lookup = buildSessionScheduleLookup(schedule);
    expect(lookup.get("1-Red")).toEqual({
      displayDate: "Saturday, June 20",
      fullDate: "2099-06-20",
      startTime: "10:00 AM",
      weighInTime: "8:00 AM",
      weightClass: "71kg",
    });
    // Falls back to the session time; whitespace in a platform name is folded
    // the way `makeLookupKey` folds it for the saved row.
    expect(lookup.get("1-Blue-Team")?.startTime).toBe("9:00 AM");
  });

  it("leaves the weigh-in unknown when a row has no start time", () => {
    expect(buildSessionScheduleLookup(schedule).get("2-Red")?.weighInTime).toBe("");
  });

  it("is empty for an empty schedule", () => {
    expect(buildSessionScheduleLookup([]).size).toBe(0);
  });
});

describe("withScheduleTimes / applyScheduleTimes", () => {
  const lookup = buildSessionScheduleLookup([
    {
      date: "Saturday, June 20",
      fullDate: "2099-06-20",
      sessions: [
        {
          id: "s-1",
          number: 1,
          startTime: "2:00 PM",
          weighInTime: "12:00 PM",
          platforms: [{ platform: "Red", weightClass: "71kg", platformStartTime: "2:00 PM" }],
        },
      ],
    },
  ] as unknown as Schedule);

  const row = (overrides: Partial<SavedSession> = {}): SavedSession => ({
    id: "Meet A-1-Red",
    meet: "Meet A" as MeetName,
    sessionNumber: 1,
    platform: "Red",
    weightClass: "71kg",
    startTime: "9:00 AM",
    weighInTime: "7:00 AM",
    date: "2099-06-19",
    notes: "mine",
    ...overrides,
  });

  it("takes the start, weigh-in and date from the schedule, keeping everything else", () => {
    expect(withScheduleTimes(row(), lookup)).toEqual({
      ...row(),
      startTime: "2:00 PM",
      weighInTime: "12:00 PM",
      date: "2099-06-20",
    });
  });

  it("returns the same row when the schedule agrees, lacks it, or is missing", () => {
    const current = row({ startTime: "2:00 PM", weighInTime: "12:00 PM", date: "2099-06-20" });
    expect(withScheduleTimes(current, lookup)).toBe(current);
    const elsewhere = row({ sessionNumber: 5 });
    expect(withScheduleTimes(elsewhere, lookup)).toBe(elsewhere);
    const plain = row();
    expect(withScheduleTimes(plain, null)).toBe(plain);
  });

  it("only touches the given meet's rows and keeps the array when nothing moved", () => {
    const other = row({ meet: "Meet B" as MeetName });
    const sessions = [row(), other];
    const next = applyScheduleTimes(sessions, "Meet A" as MeetName, lookup);
    expect(next[0].startTime).toBe("2:00 PM");
    expect(next[1]).toBe(other);
    expect(applyScheduleTimes(next, "Meet A" as MeetName, lookup)).toBe(next);
    expect(applyScheduleTimes([other], "Meet A" as MeetName, lookup)).toEqual([other]);
  });
});
