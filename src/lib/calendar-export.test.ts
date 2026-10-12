import type { MeetName } from "@/data/types/meet";
import { calendarSessionsFromSaved, groupCalendarSessions } from "@/lib/calendar-export";
import { buildSessionScheduleLookup, type SessionLookupByMeet } from "@/lib/saved-schedule-lookup";
import type { SavedSession } from "@/lib/saved-sessions-store";
import type { Schedule } from "@/types/schedule";

const MEET = "Meet A" as MeetName;

describe("groupCalendarSessions", () => {
  const row = (sessionNumber: number, platform: string, weightClass: string) => ({
    sessionNumber,
    platform,
    date: "2099-06-20",
    startTime: "9:00 AM",
    weighInTime: "7:00 AM",
    weightClass,
  });

  it("makes one event per session and platform naming every weight class in it", () => {
    expect(
      groupCalendarSessions(
        [
          row(1, "Red", "71kg"),
          row(1, "Red", "76kg"),
          row(1, "Red", "71kg"),
          row(1, "Blue", "81kg"),
          row(2, "Red", "87kg"),
        ],
        MEET,
      ),
    ).toEqual([
      expect.objectContaining({ sessionNumber: "1", platform: "Red", weightClass: "71kg, 76kg", meet: MEET }),
      expect.objectContaining({ sessionNumber: "1", platform: "Blue", weightClass: "81kg" }),
      expect.objectContaining({ sessionNumber: "2", platform: "Red", weightClass: "87kg" }),
    ]);
  });

  it("is empty for no rows", () => {
    expect(groupCalendarSessions([], MEET)).toEqual([]);
  });
});

describe("calendarSessionsFromSaved", () => {
  const lookupByMeet: SessionLookupByMeet = new Map([
    [
      MEET,
      buildSessionScheduleLookup([
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
      ] as unknown as Schedule),
    ],
  ]);
  const saved = (sessionNumber: number, meet: string = MEET): SavedSession => ({
    id: `${meet}-${sessionNumber}-Red`,
    meet: meet as MeetName,
    sessionNumber,
    platform: "Red",
    weightClass: "old",
    startTime: "9:00 AM",
    weighInTime: "7:00 AM",
    date: "2099-06-19",
  });

  it("uses the schedule row and counts sessions it cannot place", () => {
    const result = calendarSessionsFromSaved(
      [saved(1), saved(9), saved(1, "Meet B"), saved(1, "Unknown Meet")],
      lookupByMeet,
      new Set([MEET, "Meet B"]),
    );
    expect(result.sessions).toEqual([
      {
        date: "2099-06-20",
        startTime: "2:00 PM",
        weighInTime: "12:00 PM",
        sessionNumber: "1",
        platform: "Red",
        weightClass: "71kg",
        meet: MEET,
      },
    ]);
    // Session 9 has no schedule row (no date); Meet B has no schedule loaded;
    // the unknown meet is not one the app lists.
    expect(result.skipped).toBe(3);
  });
});
