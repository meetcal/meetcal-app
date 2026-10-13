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
      ).sessions,
    ).toEqual([
      expect.objectContaining({ sessionNumber: "1", platform: "Red", weightClass: "71kg, 76kg", meet: MEET }),
      expect.objectContaining({ sessionNumber: "1", platform: "Blue", weightClass: "81kg" }),
      expect.objectContaining({ sessionNumber: "2", platform: "Red", weightClass: "87kg" }),
    ]);
  });

  it("is empty for no rows", () => {
    expect(groupCalendarSessions([], MEET)).toEqual({ sessions: [], skipped: 0 });
  });

  // #283: an untimed schedule row reached the writer, which threw, and the
  // toast said to try again, which could never succeed.
  it("leaves out and counts sessions the schedule has not timed yet", () => {
    const { sessions, skipped } = groupCalendarSessions(
      [
        row(1, "Red", "71kg"),
        { ...row(2, "Red", "76kg"), startTime: "", weighInTime: "" },
        { ...row(2, "Red", "81kg"), startTime: "", weighInTime: "" },
        { ...row(3, "Blue", "87kg"), startTime: "soon" },
        { ...row(4, "Blue", "96kg"), date: "" },
        // A scraped placeholder, and a day that doesn't exist: the writer
        // rejects both, so they are skipped, not failed.
        { ...row(5, "Blue", "102kg"), date: "TBD" },
        { ...row(6, "Blue", "109kg"), date: "2099-02-30" },
      ],
      MEET,
    );
    expect(sessions.map((s) => s.sessionNumber)).toEqual(["1"]);
    expect(skipped).toBe(5);
  });

  it("counts the sessions of athletes the schedule cannot place, once each", () => {
    const athlete = (name: string, number: number, platform: string) => ({
      memberId: name,
      name,
      age: 25,
      club: "Club",
      gender: "Male",
      weightClass: "89",
      entryTotal: 0,
      adaptive: false,
      session: { number, platform },
    });
    const { sessions, skipped } = groupCalendarSessions(
      [row(1, "Red", "71kg")],
      MEET,
      [athlete("A", 7, "Red"), athlete("B", 7, "Red"), athlete("C", 7, "Blue")],
    );
    expect(sessions).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  it("keeps a timed session whose weigh-in is unknown", () => {
    const { sessions, skipped } = groupCalendarSessions(
      [{ ...row(1, "Red", "71kg"), weighInTime: "" }],
      MEET,
    );
    expect(sessions).toEqual([expect.objectContaining({ sessionNumber: "1", weighInTime: "" })]);
    expect(skipped).toBe(0);
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

  it("skips a session whose schedule row no longer has a start, not writing its saved time", () => {
    const untimed: SessionLookupByMeet = new Map([
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
                startTime: "",
                weighInTime: "",
                platforms: [{ platform: "Red", weightClass: "71kg", platformStartTime: "" }],
              },
            ],
          },
        ] as unknown as Schedule),
      ],
    ]);
    const result = calendarSessionsFromSaved([saved(1)], untimed, new Set([MEET]));
    expect(result).toEqual({ sessions: [], skipped: 1 });
  });
});
