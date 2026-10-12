/**
 * @jest-environment-options {"deviceTimeZone": "America/Los_Angeles"}
 */
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";

import type { LiftResult } from "@/data/types/athletes";
import {
  buildCalendarSessions,
  buildScheduleCsv,
  buildSessionExportRows,
  csvEscape,
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
    const rows = buildSessionExportRows(athletes, lookup);
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
      weighInTime: "7:00 AM",
      weightClass: "96",
    });
    expect(rows[2].startTime).toBe("9:00 AM");
  });
});

describe("buildCalendarSessions", () => {
  it("makes one event per session and platform", () => {
    const sessions = buildCalendarSessions(buildSessionExportRows(athletes, lookup), "Nationals");
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
      expect.objectContaining({ sessionNumber: "1", platform: "Red", weightClass: "89" }),
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
    const csv = buildScheduleCsv(buildSessionExportRows(athletes, lookup), {
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
