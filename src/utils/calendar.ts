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
import { devLog } from "@/lib/logger";
import { createSessionDetailsDeepLink } from "@/utils/deepLinks";
import { makeLookupKey } from "@/utils/session";

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

/**
 * How one export went. `created` and `updated` were written; `failed` were
 * not (the rest of the batch still was). `total` is the sessions passed in.
 */
export type CalendarWriteResult = {
  total: number;
  created: number;
  updated: number;
  failed: number;
};

const MAX_ANDROID_INT = 2_147_483_647;
const PREFERRED_ANDROID_CALENDAR_ID_KEY = "@preferred_android_calendar_id";
/** `calendarEventKey` → id of the event MeetCal created for that session. */
const CALENDAR_EVENT_IDS_KEY = "@calendar_event_ids_v1";
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
  // The one builder for this route. A hand-built `meetcal://schedule-details`
  // pointed at a route that does not exist, so tapping the event opened the
  // app on nothing.
  const deepLinkUrl = createSessionDetailsDeepLink({
    meet: session.meet,
    sessionNumber: session.sessionNumber,
    platform: session.platform,
  });

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

  // Every expo-calendar rejection is an Error with a non-empty message, so
  // returning `error.message` here made the copy above unreachable and toasted
  // raw SDK text ("Cannot find calendar with id 17") at the user. Callers show
  // `error.message` verbatim, so hand them the mapped copy and keep the
  // original for the log.
  if (error instanceof Error) {
    console.error("Calendar operation failed:", error);
  }
  return new Error(errorMessage ?? "Could not add events to calendar. Please try again.");
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

/** One calendar event per meet, session and platform. */
export function calendarEventKey(
  session: Pick<CalendarSession, "meet" | "sessionNumber" | "platform">,
): string {
  return `${session.meet}|${makeLookupKey(session.sessionNumber, session.platform)}`;
}

async function readCalendarEventIds(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(CALENDAR_EVENT_IDS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const ids: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value) ids[key] = value;
    }
    return ids;
  } catch (error) {
    console.warn("Calendar: could not read stored event ids", error);
    return {};
  }
}

async function writeCalendarEventIds(ids: Record<string, string>): Promise<void> {
  try {
    await AsyncStorage.setItem(CALENDAR_EVENT_IDS_KEY, JSON.stringify(ids));
  } catch (error) {
    console.warn("Calendar: could not store event ids", error);
  }
}

/** Whether the event MeetCal created earlier is still in a calendar. */
async function calendarEventExists(eventId: string): Promise<boolean> {
  try {
    const event = await Calendar.getEventAsync(eventId);
    return Boolean(event?.id);
  } catch {
    return false;
  }
}

/** Writes run one at a time, so two exports cannot both create the same event. */
let calendarWriteChain: Promise<unknown> = Promise.resolve();

/**
 * Write one event per session into `calendarId`. A session MeetCal already
 * added, whose event the calendar can still find by the id it returned, has
 * that event updated instead, so exporting again after saving one more
 * session, or retrying after a partial failure, does not duplicate what is
 * already there, and a session whose time moved is corrected. (An event the
 * user moved to another calendar may get a new id on iOS, and an event saved
 * through Android's calendar editor has no stored id; those can still be
 * added again.)
 *
 * A failed session does not stop the batch. Throws (with the mapped copy)
 * only when nothing could be written.
 */
export function createCalendarEventsToCalendar(
  sessions: CalendarSession[],
  calendarId: string,
): Promise<CalendarWriteResult> {
  const run = calendarWriteChain
    .catch(() => undefined)
    .then(() => writeCalendarEvents(sessions, calendarId));
  calendarWriteChain = run;
  return run;
}

async function writeCalendarEvents(
  sessions: CalendarSession[],
  calendarId: string,
): Promise<CalendarWriteResult> {
  const result: CalendarWriteResult = {
    total: sessions.length,
    created: 0,
    updated: 0,
    failed: 0,
  };
  const eventIds = await readCalendarEventIds();
  let firstError: unknown = null;

  for (const session of sessions) {
    if (!session.meet) {
      console.warn("Calendar: skipping session with no meet", session);
      result.failed += 1;
      continue;
    }

    try {
      const eventInput = await buildCalendarEventInput(session);
      const key = calendarEventKey(session);
      const existingId = eventIds[key];
      let updated = false;
      if (existingId && (await calendarEventExists(existingId))) {
        try {
          await Calendar.updateEventAsync(existingId, eventInput);
          updated = true;
        } catch (updateError) {
          // Its calendar became read-only, or it went between the two
          // calls. Write a new event rather than failing this session on
          // every export from now on.
          console.warn("Calendar: could not update the earlier event; adding it again", updateError);
        }
      }
      if (updated) {
        result.updated += 1;
      } else {
        eventIds[key] = await Calendar.createEventAsync(calendarId, eventInput);
        // Stored after every event, so a crash mid-batch cannot leave
        // written events the next export would add again.
        await writeCalendarEventIds(eventIds);
        result.created += 1;
      }
    } catch (error) {
      console.error("Calendar: event write failed", {
        calendarId,
        sessionNumber: session.sessionNumber,
        platform: session.platform,
        error,
      });
      firstError ??= error;
      result.failed += 1;
    }
  }

  if (result.failed === result.total && result.total > 0) {
    throw mapCalendarError(firstError);
  }
  return result;
}

/**
 * The toast for an export. `skipped` sessions never reached the calendar
 * (no schedule details), so they count against "Added N of M" like a failed
 * write does.
 */
export function describeCalendarWrite(
  result: CalendarWriteResult,
  { skipped = 0, calendarTitle }: { skipped?: number; calendarTitle?: string } = {},
): { type: "success" | "info" | "error"; message: string } {
  const destination = calendarTitle || "your calendar";
  const written = result.created + result.updated;
  const requested = result.total + skipped;
  const plural = (count: number) => `${count} session${count === 1 ? "" : "s"}`;

  if (written === requested) {
    if (result.created === 0) {
      return {
        type: "success",
        message: `${plural(written)} already in ${destination} ${written === 1 ? "is" : "are"} up to date.`,
      };
    }
    if (result.updated === 0) {
      return { type: "success", message: `Added ${plural(written)} to ${destination}.` };
    }
    return {
      type: "success",
      message: `Added ${plural(result.created)} to ${destination} and updated ${result.updated} already there.`,
    };
  }

  const reasons: string[] = [];
  if (skipped > 0) {
    reasons.push(`${plural(skipped)} had no schedule details.`);
  }
  if (result.failed > 0) {
    reasons.push(`${plural(result.failed)} could not be written; try again to add ${result.failed === 1 ? "it" : "them"}.`);
  }
  return {
    type: result.failed > 0 ? "error" : "info",
    message: [`Added ${written} of ${plural(requested)} to ${destination}.`, ...reasons].join(" "),
  };
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
): Promise<CalendarWriteResult> {
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

    devLog("Calendar: writing Android events to selected calendar", {
      calendarId: resolvedCalendarId,
      sessionCount: sessions.length,
    });

    return await createCalendarEventsToCalendar(sessions, resolvedCalendarId);
  } catch (error) {
    console.error("Calendar: createCalendarEvents failed", error);
    throw mapCalendarError(error);
  }
}
