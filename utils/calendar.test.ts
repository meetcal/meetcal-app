import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Calendar from "expo-calendar/legacy";
import { Platform } from "react-native";
import { clearMeetConfigCache } from "@/data/meets/config";
import { fetchMeetByName } from "@/lib/database/meet-manager";
import { createSessionDetailsDeepLink } from "@/utils/deepLinks";
import {
  type CalendarSession,
  createCalendarEvents,
  createCalendarEventsToCalendar,
  getWritableCalendars,
  resolvePreferredAndroidCalendar,
  setPreferredAndroidCalendarId,
} from "@/utils/calendar";

jest.mock("expo-calendar/legacy", () => ({
  EntityTypes: { EVENT: "event" },
  getCalendarPermissionsAsync: jest.fn(),
  requestCalendarPermissionsAsync: jest.fn(),
  getCalendarsAsync: jest.fn(async () => []),
  getDefaultCalendarAsync: jest.fn(),
  createEventAsync: jest.fn(async () => "event-1"),
  createEventInCalendarAsync: jest.fn(),
}));

jest.mock("@/lib/database/meet-manager", () => ({
  fetchMeetByName: jest.fn(),
}));

const mockFetchMeetByName = fetchMeetByName as jest.MockedFunction<typeof fetchMeetByName>;
const mockCreateEventAsync = Calendar.createEventAsync as jest.MockedFunction<
  typeof Calendar.createEventAsync
>;

const LOS_ANGELES_MEET = {
  id: "meet-1",
  name: "West Coast Open",
  venue: {
    name: "Arena",
    address: { street: "1 Main St", city: "Los Angeles", state: "CA", zip: "90001" },
  },
  time: {
    timeZone: "America/Los_Angeles",
    timeZoneIdentifier: "America/Los_Angeles" as const,
    abbreviation: "PDT",
    utcOffset: 7,
  },
  dates: { start: "2026-06-20", end: "2026-06-21" },
  status: "upcoming" as const,
};

describe("calendar event input", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearMeetConfigCache();
    mockFetchMeetByName.mockResolvedValue(LOS_ANGELES_MEET);
    // Set here, not inherited from the mock factory: the other describe's
    // afterEach restoreAllMocks wipes the factory default, so this block
    // failed whenever --randomize ran it second.
    mockCreateEventAsync.mockResolvedValue("event-1");
  });

  async function buildEvent() {
    await createCalendarEventsToCalendar(
      [
        {
          meet: "West Coast Open",
          date: "2026-06-20",
          startTime: "10:00 AM",
          weighInTime: "8:00 AM",
          sessionNumber: "3",
          platform: "Red",
          weightClass: "71kg",
        },
      ],
      "cal-1",
    );
    expect(mockCreateEventAsync).toHaveBeenCalledTimes(1);
    const [calendarId, input] = mockCreateEventAsync.mock.calls[0];
    expect(calendarId).toBe("cal-1");
    return input as {
      url: string;
      startDate: Date;
      endDate: Date;
      timeZone: string;
      notes: string;
      location: string;
    };
  }

  it("links the event to the real session-details route", async () => {
    const input = await buildEvent();

    // The hand-built `meetcal://schedule-details?...` pointed at a route that
    // does not exist; the calendar tap opened the app on nothing.
    expect(input.url).toBe(
      createSessionDetailsDeepLink({
        meet: "West Coast Open",
        sessionNumber: "3",
        platform: "Red",
      }),
    );
    expect(input.url).toBe(
      "meetcal:///shared-screens/schedule-details?meet=West+Coast+Open&sessionNumber=3&platform=Red",
    );
    expect(input.url).not.toContain("meetcal://schedule-details");
  });

  it("converts the meet-local wall clock in the meet's zone, not the device's", async () => {
    const input = await buildEvent();

    // 10:00 AM in Los Angeles on 2026-06-20 (PDT, UTC-7) is 17:00 UTC.
    expect(input.startDate.toISOString()).toBe("2026-06-20T17:00:00.000Z");
    expect(input.endDate.getTime() - input.startDate.getTime()).toBe(2 * 60 * 60 * 1000);
    expect(input.timeZone).toBe("America/Los_Angeles");
    expect(input.notes).toContain("Weigh-in Time: 8:00 AM PDT");
    expect(input.location).toBe("Arena, 1 Main St, Los Angeles, CA 90001");
  });
});

type SdkCalendar = Awaited<ReturnType<typeof Calendar.getCalendarsAsync>>[number];
const mockGetCalendarsAsync = Calendar.getCalendarsAsync as jest.MockedFunction<
  typeof Calendar.getCalendarsAsync
>;
const mockGetDefaultCalendarAsync = Calendar.getDefaultCalendarAsync as jest.MockedFunction<
  typeof Calendar.getDefaultCalendarAsync
>;

const PREFERRED_KEY = "@preferred_android_calendar_id";

function sdkCalendar(overrides: Partial<SdkCalendar> & { id: string }): SdkCalendar {
  return {
    title: overrides.id,
    allowsModifications: true,
    isPrimary: false,
    ownerAccount: null,
    source: { name: "Local", isLocalAccount: false },
    ...overrides,
  } as SdkCalendar;
}

/**
 * Runs the module as on one platform. The jest-expo preset resolves the iOS
 * `Platform`, whose `select` ignores `OS`, so both are replaced.
 */
function onPlatform(os: "ios" | "android") {
  jest.replaceProperty(Platform, "OS", os);
  jest
    .spyOn(Platform, "select")
    .mockImplementation(((spec: Record<string, unknown>) =>
      os in spec ? spec[os] : spec.default) as typeof Platform.select);
}

const SESSION: CalendarSession = {
  meet: "West Coast Open",
  date: "2026-06-20",
  startTime: "10:00 AM",
  weighInTime: "8:00 AM",
  sessionNumber: "3",
  platform: "Red",
  weightClass: "71kg",
};

describe("calendar destinations and failures", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    clearMeetConfigCache();
    mockFetchMeetByName.mockResolvedValue(LOS_ANGELES_MEET);
    mockCreateEventAsync.mockResolvedValue("event-1");
    await AsyncStorage.clear();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getWritableCalendars on Android", () => {
    beforeEach(() => onPlatform("android"));

    it("drops read-only calendars and ids past Android's INT_MAX, then orders them", async () => {
      mockGetCalendarsAsync.mockResolvedValue([
        sdkCalendar({ id: "1", title: "Zeta", ownerAccount: "me@example.com" }),
        sdkCalendar({ id: "2", title: "Holidays", allowsModifications: false }),
        sdkCalendar({ id: "2147483648", title: "Overflow", isPrimary: true }),
        sdkCalendar({ id: "2147483647", title: "Alpha", ownerAccount: "me@example.com" }),
        sdkCalendar({ id: "3", title: "Device", source: { name: "Phone", isLocalAccount: true, type: "local" } }),
        sdkCalendar({ id: "4", title: "Work", isPrimary: true, ownerAccount: "work@example.com" }),
        sdkCalendar({ id: "5", title: "No Owner" }),
        sdkCalendar({ id: "acct-x", title: "Beta", ownerAccount: "me@example.com" }),
      ]);

      const calendars = await getWritableCalendars();

      // Primary first; then synced before on-device; then owned; then title.
      expect(calendars.map((c) => c.id)).toEqual([
        "4",
        "2147483647",
        "acct-x",
        "1",
        "5",
        "3",
      ]);
      expect(calendars[0]).toEqual({
        id: "4",
        label: "Work - work@example.com - Primary",
        title: "Work",
        ownerAccount: "work@example.com",
        isPrimary: true,
        sourceName: "Local",
      });
      expect(calendars.find((c) => c.id === "3")?.label).toBe("Device - Phone");
    });
  });

  it("getWritableCalendars on iOS keeps every writable calendar in SDK order", async () => {
    onPlatform("ios");
    mockGetCalendarsAsync.mockResolvedValue([
      sdkCalendar({ id: "B", title: "Home" }),
      sdkCalendar({ id: "A", title: "Birthdays", allowsModifications: false }),
      sdkCalendar({ id: "9999999999", title: "Big id" }),
    ]);
    await expect(getWritableCalendars()).resolves.toMatchObject([{ id: "B" }, { id: "9999999999" }]);
  });

  describe("resolvePreferredAndroidCalendar", () => {
    beforeEach(() => onPlatform("android"));

    it("returns the stored calendar while it still exists", async () => {
      mockGetCalendarsAsync.mockResolvedValue([sdkCalendar({ id: "7", title: "Mine" })]);
      await setPreferredAndroidCalendarId("7");
      await expect(resolvePreferredAndroidCalendar()).resolves.toMatchObject({ id: "7" });
      await expect(AsyncStorage.getItem(PREFERRED_KEY)).resolves.toBe("7");
    });

    it.each([
      ["was removed from the device", "8", [sdkCalendar({ id: "7" })]],
      ["became read-only", "7", [sdkCalendar({ id: "7", allowsModifications: false })]],
      ["has an id past INT_MAX", "2147483648", [sdkCalendar({ id: "2147483648" })]],
    ])("clears the preference when the calendar %s", async (_label, stored, calendars) => {
      mockGetCalendarsAsync.mockResolvedValue(calendars);
      await setPreferredAndroidCalendarId(stored);
      await expect(resolvePreferredAndroidCalendar()).resolves.toBeNull();
      await expect(AsyncStorage.getItem(PREFERRED_KEY)).resolves.toBeNull();
    });

    it("returns null without a preference", async () => {
      mockGetCalendarsAsync.mockResolvedValue([sdkCalendar({ id: "7" })]);
      await expect(resolvePreferredAndroidCalendar()).resolves.toBeNull();
    });
  });

  describe("createCalendarEvents on Android", () => {
    beforeEach(() => onPlatform("android"));

    it("asks for a default calendar when none is chosen, writing nothing", async () => {
      mockGetCalendarsAsync.mockResolvedValue([sdkCalendar({ id: "7" })]);
      await expect(createCalendarEvents([SESSION])).rejects.toThrow(
        "Choose a default calendar on this device before adding sessions.",
      );
      expect(mockCreateEventAsync).not.toHaveBeenCalled();
    });

    it("writes to the stored calendar", async () => {
      mockGetCalendarsAsync.mockResolvedValue([sdkCalendar({ id: "7" })]);
      await setPreferredAndroidCalendarId("7");
      await expect(createCalendarEvents([SESSION])).resolves.toEqual(["event-1"]);
      expect(mockCreateEventAsync.mock.calls[0][0]).toBe("7");
    });

    it("shows the platform copy, not the SDK's text, when the SDK rejects", async () => {
      mockCreateEventAsync.mockRejectedValue(new Error("Cannot find calendar with id 17"));
      const failure = (await createCalendarEvents([SESSION], "17").catch((e: unknown) => e)) as Error;
      expect(failure.message).toBe(
        "Could not add events to calendar. Please make sure you have a calendar account configured and try again.",
      );
      expect(failure.message).not.toContain("id 17");
    });
  });

  describe("createCalendarEvents on iOS", () => {
    beforeEach(() => onPlatform("ios"));

    it("falls back to the first writable calendar, never a read-only one", async () => {
      mockGetDefaultCalendarAsync.mockRejectedValue(new Error("no default"));
      mockGetCalendarsAsync.mockResolvedValue([
        sdkCalendar({ id: "subscribed", allowsModifications: false }),
        sdkCalendar({ id: "home" }),
      ]);
      await createCalendarEvents([SESSION]);
      expect(mockCreateEventAsync.mock.calls[0][0]).toBe("home");
    });

    it("says no calendar is set up when every calendar is read-only", async () => {
      mockGetDefaultCalendarAsync.mockResolvedValue(null as never);
      mockGetCalendarsAsync.mockResolvedValue([
        sdkCalendar({ id: "subscribed", allowsModifications: false }),
      ]);
      await expect(createCalendarEvents([SESSION])).rejects.toThrow("No suitable calendar found");
      expect(mockCreateEventAsync).not.toHaveBeenCalled();
    });

    it("shows the iOS copy when the SDK rejects", async () => {
      mockGetDefaultCalendarAsync.mockResolvedValue(sdkCalendar({ id: "home" }) as never);
      mockCreateEventAsync.mockRejectedValue(new Error("EKErrorDomain error 1"));
      await expect(createCalendarEvents([SESSION])).rejects.toThrow(
        /^Could not add events to calendar\. Please try again\.$/,
      );
    });
  });
});
