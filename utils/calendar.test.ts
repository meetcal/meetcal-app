import * as Calendar from "expo-calendar/legacy";
import { clearMeetConfigCache } from "@/data/meets/config";
import { fetchMeetByName } from "@/lib/database/meet-manager";
import { createSessionDetailsDeepLink } from "@/utils/deepLinks";
import { createCalendarEventsToCalendar } from "@/utils/calendar";

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
