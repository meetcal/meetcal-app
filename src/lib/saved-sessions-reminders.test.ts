import AsyncStorage from "@react-native-async-storage/async-storage";
import { convertToUTC } from "@/data/meets/config";
import { fetchSchedule } from "@/lib/database/queries";
import {
  cancelSavedSessionReminder,
  findScheduledSession,
  NOTIFICATION_LEAD_MS,
  reminderTriggerDate,
  scheduleSavedSessionReminder,
} from "@/lib/saved-sessions-reminders";
import type { SavedSession } from "@/lib/saved-sessions-store";
import type { Schedule } from "@/types/schedule";
import {
  cancelNotification,
  NOTIFICATION_ENABLED_KEY,
  scheduleNotification,
} from "@/utils/notifications";

jest.mock("@/lib/database/queries", () => ({ fetchSchedule: jest.fn() }));

jest.mock("@/utils/notifications", () => ({
  NOTIFICATION_ENABLED_KEY: "notificationsEnabled",
  scheduleNotification: jest.fn(async () => "notification-id"),
  cancelNotification: jest.fn(async () => undefined),
}));

jest.mock("@/data/meets/config", () => ({
  getMeetConfig: jest.fn(async () => ({
    time: { timeZoneIdentifier: "America/New_York" },
  })),
  convertToUTC: jest.fn(() => new Date("2099-06-20T15:00:00.000Z")),
}));

const mockFetchSchedule = fetchSchedule as jest.MockedFunction<typeof fetchSchedule>;
const mockConvertToUTC = convertToUTC as jest.MockedFunction<typeof convertToUTC>;
const mockScheduleNotification = scheduleNotification as jest.MockedFunction<
  typeof scheduleNotification
>;

const SCHEDULE = [
  {
    date: "June 20, 2099",
    fullDate: "2099-06-20",
    sessions: [
      {
        id: "s1",
        number: 1,
        startTime: "10:00 AM",
        weighInTime: "8:00 AM",
        platforms: [{ platform: "Red", weightClass: "71kg", platformStartTime: "11:00 AM" }],
      },
    ],
  },
  {
    date: "June 21, 2099",
    fullDate: "2099-06-21",
    sessions: [
      { id: "s2", number: 2, startTime: "9:00 AM", weighInTime: "7:00 AM", platforms: [] },
    ],
  },
] as unknown as Schedule;

const SESSION: SavedSession = {
  id: "Test-Meet-1-Red",
  meet: "Test Meet" as never,
  sessionNumber: 1,
  platform: "Red",
  weightClass: "71kg",
  startTime: "11:00 AM",
  weighInTime: "9:00 AM",
  date: "2099-06-20",
};

let logSpy: jest.SpyInstance;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  // The `[notifications]` dev trace.
  logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
});

describe("findScheduledSession", () => {
  it("finds the session and its day's date", () => {
    expect(findScheduledSession(SCHEDULE, 2)).toEqual({
      session: SCHEDULE[1].sessions[0],
      date: "2099-06-21",
    });
  });

  it("returns null when the schedule does not have the session", () => {
    expect(findScheduledSession(SCHEDULE, 3)).toBeNull();
    expect(findScheduledSession([], 1)).toBeNull();
  });
});

describe("reminderTriggerDate", () => {
  it("fires one hour before the session starts", () => {
    const start = new Date("2099-06-20T15:00:00.000Z");
    expect(NOTIFICATION_LEAD_MS).toBe(60 * 60 * 1000);
    expect(reminderTriggerDate(start).toISOString()).toBe("2099-06-20T14:00:00.000Z");
  });
});

describe("scheduleSavedSessionReminder", () => {
  it("does nothing, and fetches nothing, when notifications are off", async () => {
    await scheduleSavedSessionReminder(SESSION);
    expect(mockFetchSchedule).not.toHaveBeenCalled();
    expect(mockScheduleNotification).not.toHaveBeenCalled();
  });

  it("schedules from the caller's schedule in the meet's time zone", async () => {
    await scheduleSavedSessionReminder(SESSION, {
      schedule: SCHEDULE,
      notificationsEnabled: true,
    });
    expect(mockFetchSchedule).not.toHaveBeenCalled();
    expect(mockConvertToUTC).toHaveBeenCalledWith("11:00 AM", "2099-06-20", "America/New_York");
    expect(mockScheduleNotification).toHaveBeenCalledWith(
      "Session Reminder",
      "Session 1 Red starts in 1 hour.",
      new Date("2099-06-20T14:00:00.000Z"),
      SESSION.id,
      expect.objectContaining({ id: SESSION.id, startTime: "11:00 AM", date: "2099-06-20" }),
    );
  });

  it("reads the preference and fetches the schedule when not given them", async () => {
    await AsyncStorage.setItem(NOTIFICATION_ENABLED_KEY, "true");
    mockFetchSchedule.mockResolvedValueOnce(SCHEDULE);
    await scheduleSavedSessionReminder(SESSION, { schedule: [] });
    expect(mockFetchSchedule).toHaveBeenCalledWith("Test Meet");
    expect(mockScheduleNotification).toHaveBeenCalledTimes(1);
  });

  it("does not schedule a reminder whose time has passed", async () => {
    mockConvertToUTC.mockReturnValueOnce(new Date("2000-01-01T00:00:00.000Z"));
    await scheduleSavedSessionReminder(SESSION, {
      schedule: SCHEDULE,
      notificationsEnabled: true,
    });
    expect(mockScheduleNotification).not.toHaveBeenCalled();
  });

  it("logs rather than throws when scheduling fails", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockScheduleNotification.mockRejectedValueOnce(new Error("denied"));
    await expect(
      scheduleSavedSessionReminder(SESSION, { schedule: SCHEDULE, notificationsEnabled: true }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("cancelSavedSessionReminder", () => {
  it("cancels only when notifications are on", async () => {
    await cancelSavedSessionReminder(SESSION.id, SESSION);
    expect(cancelNotification).not.toHaveBeenCalled();
    await AsyncStorage.setItem(NOTIFICATION_ENABLED_KEY, "true");
    await cancelSavedSessionReminder(SESSION.id, SESSION);
    expect(cancelNotification).toHaveBeenCalledWith(SESSION.id);
  });

  it("warns when the session was not in storage", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    await cancelSavedSessionReminder("missing", undefined);
    expect(warnSpy).toHaveBeenCalled();
    expect(cancelNotification).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
