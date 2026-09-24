import type { MeetName } from "@/data/types/meet";
import {
  buildSessionScheduleLookup,
  savedScheduleMeet,
} from "@/lib/saved-schedule-lookup";
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
            { platform: "Blue Team", weightClass: "76kg", platformStartTime: "" },
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
