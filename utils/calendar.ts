import * as Calendar from "expo-calendar";
import { Platform } from "react-native";
import { MeetName } from "@/data/types/meet";
import {
  convertToUTC,
  formatTimeWithZone,
  getMeetConfig,
  getMeetVenueLocation,
} from "@/data/meets/config";

export async function requestCalendarPermissions(): Promise<boolean> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  return status === "granted";
}

export type CalendarSession = {
  date: string;
  startTime: string;
  weighInTime: string;
  sessionNumber: string;
  platform: string;
  weightClass: string;
  meet: MeetName;
};

export async function createCalendarEvents(
  sessions: CalendarSession[],
): Promise<void> {
  try {
    let calendarId;

    if (Platform.OS === "ios") {
      try {
        const calendar = await Calendar.getDefaultCalendarAsync();
        if (calendar?.id) {
          calendarId = calendar.id;
        } else {
          // Fall back to searching calendars like Android
          const calendars = await Calendar.getCalendarsAsync(
            Calendar.EntityTypes.EVENT,
          );
          const fallback = calendars.find(
            (cal) => cal.allowsModifications,
          );
          if (!fallback) {
            throw new Error("no_calendar");
          }
          calendarId = fallback.id;
        }
      } catch (e) {
        if (e instanceof Error && e.message === "no_calendar") throw e;
        // Fall back to searching calendars
        const calendars = await Calendar.getCalendarsAsync(
          Calendar.EntityTypes.EVENT,
        );
        const fallback = calendars.find(
          (cal) => cal.allowsModifications,
        );
        if (!fallback) {
          throw new Error("no_calendar");
        }
        calendarId = fallback.id;
      }
    } else {
      const calendars = await Calendar.getCalendarsAsync(
        Calendar.EntityTypes.EVENT,
      );
      const primaryCalendar = calendars.find(
        (cal) =>
          cal.accessLevel === Calendar.CalendarAccessLevel.OWNER &&
          cal.allowsModifications,
      );

      if (!primaryCalendar) {
        throw new Error("no_calendar");
      }

      calendarId = primaryCalendar.id;
    }

    for (const session of sessions) {
      if (!session.meet) {
        console.warn("Skipping session with no meet:", session);
        continue;
      }

      // Get meet config first
      const meetConfig = await getMeetConfig(session.meet);

      // Convert times to UTC using the meet's time zone
      const startDate = convertToUTC(
        session.startTime,
        session.date,
        session.meet,
      );
      const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);

      // Construct the deep link URL
      const deepLinkUrl = `meetcal://schedule-details?meet=${encodeURIComponent(session.meet)}&sessionNumber=${encodeURIComponent(session.sessionNumber)}&platform=${encodeURIComponent(session.platform)}`;

      await Calendar.createEventAsync(calendarId, {
        title: `Session ${session.sessionNumber} - Platform ${session.platform}`,
        location: getMeetVenueLocation(session.meet),
        notes: `Weight Class: ${session.weightClass}\nWeigh-in Time: ${formatTimeWithZone(session.weighInTime, session.meet)}`,
        startDate: startDate,
        endDate: endDate,
        timeZone: meetConfig.time.timeZoneIdentifier,
        url: deepLinkUrl,
        alarms: [
          {
            relativeOffset: -60,
          },
        ],
      });
    }
  } catch (error) {
    console.error("Error creating calendar events:", error);

    if (error instanceof Error && error.message === "no_calendar") {
      throw new Error(
        "No suitable calendar found. Please make sure you have at least one calendar set up on your device.",
      );
    }

    const errorMessage = Platform.select({
      ios: "Could not add events to calendar. Please try again.",
      android:
        "Could not add events to calendar. Please make sure you have a calendar app installed and try again.",
      default: "Could not add events to calendar. Please try again.",
    });

    throw new Error(errorMessage);
  }
}
