/**
 * @jest-environment-options {"deviceTimeZone": "America/Los_Angeles"}
 */
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";

import type { LiftResult } from "@/data/types/athletes";
import { groupCalendarSessions } from "@/lib/calendar-export";
import {
  buildScheduleCsv,
  buildSessionExportRows,
  csvEscape,
  describeIncompleteShare,
  scheduleCsvFileName,
  shareScheduleCsv,
} from "@/lib/start-list-export";
import { buildSessionDetailsLookup } from "@/lib/start-list-utils";
import type { Schedule } from "@/types/schedule";

jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {}),
}));
const mockWrite = jest.fn(async () => {});
jest.mock("expo-file-system", () => ({
  Paths: { cache: "cache-dir" },
  File: jest.fn().mockImplementation((dir: string, name: string) => ({
    uri: `file://${dir}/${name}`,
    write: (...args: unknown[]) => mockWrite(...(args as [])),
  })),
}));

const SCHEDULE: Schedule = [
  {
    date: "Saturday",
    fullDate: "2026-06-20",
    sessions: [
      {
        id: "s1",
        number: 1,
        startTime: "9:00 AM",
        weighInTime: "7:00 AM",
        platforms: [
          { platform: "Red", weightClass: "89" },
          { platform: "Blue", weightClass: "96", platformStartTime: "11:00" },
        ],
      },
    ],
  },
  {
    date: "Sunday",
    fullDate: "2026-06-21",
    sessions: [
      {
        id: "s2",
        number: 2,
        startTime: "8:00 AM",
        weighInTime: "6:00 AM",
        platforms: [{ platform: "Red", weightClass: "102" }],
      },
    ],
  },
];

function lifter(
  name: string,
  session: LiftResult["session"],
  weightClass = "89",
): LiftResult {
  return {
    memberId: name,
    name,
    age: 25,
    club: "Club",
    gender: "Male",
    weightClass,
    entryTotal: 0,
    adaptive: false,
    session,
  };
}

const lookup = buildSessionDetailsLookup(SCHEDULE);
const athletes = [
  lifter("Zed Sunday", { number: 2, platform: "Red" }, "102"),
  lifter("Bea Blue", { number: 1, platform: "Blue" }, "96"),
  lifter("Al Red", { number: 1, platform: "Red" }),
  lifter("Cy Red", { number: 1, platform: "Red" }, "81"),
  lifter("No Session", undefined),
  lifter("Unknown Session", { number: 9, platform: "Red" }),
];

describe("buildSessionExportRows", () => {
  it("places athletes the schedule knows, with the platform's own start time", () => {
    const { rows, unscheduled } = buildSessionExportRows(athletes, lookup);
    // Entered in a session the schedule has no row for: left out, but kept
    // so the exports can say so. An athlete with no session is neither.
    expect(unscheduled.map((a) => a.name)).toEqual(["Unknown Session"]);
    expect(rows.map((r) => r.athlete.name)).toEqual([
      "Zed Sunday",
      "Bea Blue",
      "Al Red",
      "Cy Red",
    ]);
    expect(rows[1]).toMatchObject({
      sessionNumber: 1,
      platform: "Blue",
      date: "2026-06-20",
      startTime: "11:00",
      // The session's published 7:00 AM is the Red row's; Blue starts at
      // 11:00, so its weigh-in is 9:00 AM (#281).
      weighInTime: "9:00 AM",
      weightClass: "96",
    });
    expect(rows[2].startTime).toBe("9:00 AM");
  });

  // #281: Red at 9:00 and Blue at 9:30 with the session's published weigh-in
  // 7:00 (Red's row). Blue's event said 7:00 here and 7:30 everywhere else.
  it("resolves each platform's weigh-in by the shared rule", () => {
    const schedule: Schedule = [
      {
        date: "Saturday",
        fullDate: "2026-06-20",
        sessions: [
          {
            id: "s5",
            number: 5,
            startTime: "9:00 AM",
            weighInTime: "7:00 AM",
            platforms: [
              { platform: "Red", weightClass: "89", platformStartTime: "9:00 AM", platformWeighInTime: "7:00 AM" },
              { platform: "Blue", weightClass: "96", platformStartTime: "9:30 AM", platformWeighInTime: "" },
              { platform: "White", weightClass: "102", platformStartTime: "10:00 AM", platformWeighInTime: "8:15 AM" },
            ],
          },
        ],
      },
    ];
    const { rows } = buildSessionExportRows(
      [
        lifter("Red", { number: 5, platform: "Red" }),
        lifter("Blue", { number: 5, platform: "Blue" }),
        lifter("White", { number: 5, platform: "White" }),
      ],
      buildSessionDetailsLookup(schedule),
    );
    expect(rows.map((r) => [r.startTime, r.weighInTime])).toEqual([
      ["9:00 AM", "7:00 AM"],
      ["9:30 AM", "7:30 AM"],
      ["10:00 AM", "8:15 AM"],
    ]);
  });
});

describe("describeIncompleteShare", () => {
  it("is null when every athlete is in the schedule", () => {
    expect(describeIncompleteShare(3, 3)).toBeNull();
    expect(describeIncompleteShare(0, 0)).toBeNull();
  });

  it("says how many athletes a share leaves out", () => {
    expect(describeIncompleteShare(40, 0)).toBe(
      "40 athletes of 40 have no session on the schedule yet and won't be included. Share anyway?",
    );
    expect(describeIncompleteShare(5, 4)).toBe(
      "1 athlete of 5 has no session on the schedule yet and won't be included. Share anyway?",
    );
  });
});

// The Start List's Add to Calendar: its rows grouped by `groupCalendarSessions`.
describe("calendar events from the export rows", () => {
  it("makes one event per session and platform naming every weight class", () => {
    const { rows, unscheduled } = buildSessionExportRows(athletes, lookup);
    const { sessions, skipped } = groupCalendarSessions(rows, "Nationals", unscheduled);
    // Session 9 / Red has no schedule row: counted, so the toast says 3 of 4.
    expect(skipped).toBe(1);
    expect(sessions).toEqual([
      {
        date: "2026-06-21",
        startTime: "8:00 AM",
        weighInTime: "6:00 AM",
        sessionNumber: "2",
        platform: "Red",
        weightClass: "102",
        meet: "Nationals",
      },
      expect.objectContaining({ sessionNumber: "1", platform: "Blue" }),
      expect.objectContaining({ sessionNumber: "1", platform: "Red", weightClass: "89, 81" }),
    ]);
  });
});

describe("csvEscape", () => {
  it("quotes only cells that need it and doubles inner quotes", () => {
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("two\nlines")).toBe('"two\nlines"');
  });
});

describe("buildScheduleCsv", () => {
  it("orders by meet date, then start time, then name, in meet-calendar dates", () => {
    const csv = buildScheduleCsv(buildSessionExportRows(athletes, lookup).rows, {
      group: "Barbell, Inc",
      meet: "Nationals",
    });
    expect(csv.split("\n")).toEqual([
      "Group,Meet,Name,Weight Class,Session,Platform,Date,Start Time",
      '"Barbell, Inc",Nationals,Al Red,89,1,Red,"Sat, Jun 20",9:00 AM',
      '"Barbell, Inc",Nationals,Cy Red,81,1,Red,"Sat, Jun 20",9:00 AM',
      '"Barbell, Inc",Nationals,Bea Blue,96,1,Blue,"Sat, Jun 20",11:00 AM',
      '"Barbell, Inc",Nationals,Zed Sunday,102,2,Red,"Sun, Jun 21",8:00 AM',
    ]);
  });

  it("is just the header with no rows", () => {
    expect(buildScheduleCsv([], { group: "G", meet: "M" })).toBe(
      "Group,Meet,Name,Weight Class,Session,Platform,Date,Start Time",
    );
  });
});

describe("scheduleCsvFileName", () => {
  it("makes the group file-safe", () => {
    expect(scheduleCsvFileName("  Barbell Club / East! ", 123)).toBe(
      "meetcal-schedule-barbell-club-east-123.csv",
    );
  });
});

describe("shareScheduleCsv", () => {
  beforeEach(() => jest.clearAllMocks());

  it("writes the file before opening the share sheet", async () => {
    await expect(shareScheduleCsv("a,b", "x.csv")).resolves.toBe(true);
    expect(FileSystem.File).toHaveBeenCalledWith("cache-dir", "x.csv");
    expect(mockWrite).toHaveBeenCalledWith("a,b", { encoding: "utf8" });
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      "file://cache-dir/x.csv",
      expect.objectContaining({ mimeType: "text/csv" }),
    );
    expect(mockWrite.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(Sharing.shareAsync).mock.invocationCallOrder[0],
    );
  });

  it("writes nothing when the device cannot share", async () => {
    jest.mocked(Sharing.isAvailableAsync).mockResolvedValueOnce(false);
    await expect(shareScheduleCsv("a,b", "x.csv")).resolves.toBe(false);
    expect(mockWrite).not.toHaveBeenCalled();
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });
});
