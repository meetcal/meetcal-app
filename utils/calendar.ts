import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Calendar from "expo-calendar/legacy";
import { Platform } from "react-native";
import { MeetName } from "@/data/types/meet";
import {
  convertToUTC,
  formatTimeWithZone,
  getMeetConfig,
  getMeetVenueLocation,
} from "@/data/meets/config";

export async function requestCalendarPermissions(): Promise<boolean> {
  const currentPermissions = await Calendar.getCalendarPermissionsAsync();
  if (currentPermissions.status === "granted") {
    return true;
  }

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

export type CalendarDestination = {
  id: string;
  label: string;
  title: string;
  ownerAccount?: string | null;
  isPrimary?: boolean;
  sourceName?: string | null;
};

const MAX_ANDROID_INT = 2_147_483_647;
const PREFERRED_ANDROID_CALENDAR_ID_KEY = "@preferred_android_calendar_id";
type WritableCalendar = Awaited<
  ReturnType<typeof Calendar.getCalendarsAsync>
>[number];

function isAndroidSafeCalendarId(calendarId: string): boolean {
  if (!/^\d+$/.test(calendarId)) {
    return true;
  }

  return Number(calendarId) <= MAX_ANDROID_INT;
}

function isWritableAndroidCalendar(calendar: WritableCalendar): boolean {
  return calendar.allowsModifications && isAndroidSafeCalendarId(calendar.id);
}

function compareAndroidCalendars(
  left: WritableCalendar,
  right: WritableCalendar,
): number {
  const leftPrimary = left.isPrimary ? 1 : 0;
  const rightPrimary = right.isPrimary ? 1 : 0;
  if (leftPrimary !== rightPrimary) {
    return rightPrimary - leftPrimary;
  }

  const leftLocal = left.source?.isLocalAccount ? 1 : 0;
  const rightLocal = right.source?.isLocalAccount ? 1 : 0;
  if (leftLocal !== rightLocal) {
    return leftLocal - rightLocal;
  }

  const leftHasOwner = left.ownerAccount ? 1 : 0;
  const rightHasOwner = right.ownerAccount ? 1 : 0;
  if (leftHasOwner !== rightHasOwner) {
    return rightHasOwner - leftHasOwner;
  }

  return (left.title || "").localeCompare(right.title || "");
}

function buildCalendarLabel(calendar: WritableCalendar): string {
  const parts = [calendar.title];
  if (calendar.ownerAccount && calendar.ownerAccount !== calendar.title) {
    parts.push(calendar.ownerAccount);
  } else if (
    calendar.source?.name &&
    calendar.source.name !== calendar.title
  ) {
    parts.push(calendar.source.name);
  }

  if (calendar.isPrimary) {
    parts.push("Primary");
  }

  return parts.filter(Boolean).join(" - ");
}

function toCalendarDestination(
  calendar: WritableCalendar,
): CalendarDestination {
  return {
    id: calendar.id,
    label: buildCalendarLabel(calendar),
    title: calendar.title,
    ownerAccount: calendar.ownerAccount,
    isPrimary: calendar.isPrimary,
    sourceName: calendar.source?.name ?? null,
  };
}

async function getIosDefaultCalendarId(): Promise<string> {
  try {
    const calendar = await Calendar.getDefaultCalendarAsync();
    if (calendar?.id) {
      return calendar.id;
    }
  } catch (error) {
    console.warn("Calendar: failed to load default iOS calendar", error);
  }

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const fallback = calendars.find((calendar) => calendar.allowsModifications);
  if (!fallback) {
    throw new Error("no_calendar");
  }

  return fallback.id;
}

async function buildCalendarEventInput(session: CalendarSession) {
  const meetConfig = await getMeetConfig(session.meet);
  const startDate = convertToUTC(
    session.startTime,
    session.date,
    meetConfig.time.timeZoneIdentifier,
  );
  const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);
  const deepLinkUrl = `meetcal://schedule-details?meet=${encodeURIComponent(session.meet)}&sessionNumber=${encodeURIComponent(session.sessionNumber)}&platform=${encodeURIComponent(session.platform)}`;

  return {
    title: `Session ${session.sessionNumber} - Platform ${session.platform}`,
    location: getMeetVenueLocation(session.meet),
    notes: `Weight Class: ${session.weightClass}\nWeigh-in Time: ${formatTimeWithZone(session.weighInTime, session.meet)}`,
    startDate,
    endDate,
    timeZone: meetConfig.time.timeZoneIdentifier,
    url: deepLinkUrl,
    alarms: [
      {
        relativeOffset: -60,
      },
    ],
  };
}

function mapCalendarError(error: unknown): Error {
  if (error instanceof Error && error.message === "no_calendar") {
    return new Error(
      "No suitable calendar found. Please make sure you have at least one calendar set up on your device.",
    );
  }

  if (
    error instanceof Error &&
    error.message === "no_preferred_android_calendar"
  ) {
    return new Error(
      "Choose a default calendar on this device before adding sessions.",
    );
  }

  if (
    error instanceof Error &&
    error.message === "android_system_calendar_ui_unavailable"
  ) {
    return new Error(
      "Could not open the Android calendar app. Please choose a default calendar and try again.",
    );
  }

  const errorMessage = Platform.select({
    ios: "Could not add events to calendar. Please try again.",
    android:
      "Could not add events to calendar. Please make sure you have a calendar account configured and try again.",
    default: "Could not add events to calendar. Please try again.",
  });

  return error instanceof Error ? new Error(error.message || errorMessage) : new Error(errorMessage);
}

export async function getWritableCalendars(): Promise<CalendarDestination[]> {
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);

  if (Platform.OS !== "android") {
    return calendars
      .filter((calendar) => calendar.allowsModifications)
      .map(toCalendarDestination);
  }

  return calendars
    .filter(isWritableAndroidCalendar)
    .sort(compareAndroidCalendars)
    .map(toCalendarDestination);
}

export async function getPreferredAndroidCalendarId(): Promise<string | null> {
  if (Platform.OS !== "android") {
    return null;
  }

  const value = await AsyncStorage.getItem(PREFERRED_ANDROID_CALENDAR_ID_KEY);
  return value || null;
}

export async function setPreferredAndroidCalendarId(
  calendarId: string,
): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }

  await AsyncStorage.setItem(PREFERRED_ANDROID_CALENDAR_ID_KEY, calendarId);
}

export async function clearPreferredAndroidCalendarId(): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }

  await AsyncStorage.removeItem(PREFERRED_ANDROID_CALENDAR_ID_KEY);
}

export async function resolvePreferredAndroidCalendar(): Promise<CalendarDestination | null> {
  if (Platform.OS !== "android") {
    return null;
  }

  const [preferredCalendarId, calendars] = await Promise.all([
    getPreferredAndroidCalendarId(),
    getWritableCalendars(),
  ]);

  if (!preferredCalendarId) {
    return null;
  }

  const selectedCalendar =
    calendars.find((calendar) => calendar.id === preferredCalendarId) ?? null;

  if (!selectedCalendar) {
    console.warn(
      "Calendar: stored Android calendar no longer available, clearing preference",
      { preferredCalendarId },
    );
    await clearPreferredAndroidCalendarId();
  }

  return selectedCalendar;
}

export async function createCalendarEventsToCalendar(
  sessions: CalendarSession[],
  calendarId: string,
): Promise<string[]> {
  try {
    const eventIds: string[] = [];

    for (const session of sessions) {
      if (!session.meet) {
        console.warn("Calendar: skipping session with no meet", session);
        continue;
      }

      const eventInput = await buildCalendarEventInput(session);
      const eventId = await Calendar.createEventAsync(calendarId, eventInput);
      eventIds.push(eventId);
    }

    return eventIds;
  } catch (error) {
    console.error("Calendar: direct event creation failed", {
      calendarId,
      error,
    });
    throw mapCalendarError(error);
  }
}

export async function createCalendarEventWithSystemUI(
  session: CalendarSession,
): Promise<void> {
  try {
    if (Platform.OS !== "android") {
      const calendarId = await getIosDefaultCalendarId();
      await createCalendarEventsToCalendar([session], calendarId);
      return;
    }

    const eventInput = await buildCalendarEventInput(session);
    await Calendar.createEventInCalendarAsync(eventInput, {
      startNewActivityTask: false,
    });
  } catch (error) {
    console.error("Calendar: failed to open system calendar UI", error);

    if (
      error instanceof Error &&
      error.message.includes("createEventInCalendarAsync")
    ) {
      throw mapCalendarError(
        new Error("android_system_calendar_ui_unavailable"),
      );
    }

    throw mapCalendarError(error);
  }
}

export async function createCalendarEvents(
  sessions: CalendarSession[],
  calendarId?: string,
): Promise<string[]> {
  try {
    if (Platform.OS === "ios") {
      const iosCalendarId = await getIosDefaultCalendarId();
      return await createCalendarEventsToCalendar(sessions, iosCalendarId);
    }

    const resolvedCalendarId =
      calendarId ?? (await resolvePreferredAndroidCalendar())?.id;

    if (!resolvedCalendarId) {
      throw new Error("no_preferred_android_calendar");
    }

    console.log("Calendar: writing Android events to selected calendar", {
      calendarId: resolvedCalendarId,
      sessionCount: sessions.length,
    });

    return await createCalendarEventsToCalendar(sessions, resolvedCalendarId);
  } catch (error) {
    console.error("Calendar: createCalendarEvents failed", error);
    throw mapCalendarError(error);
  }
}
