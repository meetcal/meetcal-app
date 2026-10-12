import { useCallback, useState } from "react";
import { Alert, Platform } from "react-native";

import { showToast } from "@/components/ui/Toast";
import {
  type CalendarDestination,
  type CalendarSession,
  createCalendarEventWithSystemUI,
  createCalendarEvents,
  createCalendarEventsToCalendar,
  describeCalendarWrite,
  getWritableCalendars,
  requestCalendarPermissions,
  resolvePreferredAndroidCalendar,
  setPreferredAndroidCalendarId,
} from "@/utils/calendar";

export interface CalendarExportOptions {
  /**
   * Sessions the caller could not turn into events (no schedule details).
   * They count against the "Added N of M" toast.
   */
  skipped?: number;
  /** Ask "Add N sessions to your calendar?" first. Default true. */
  confirm?: boolean;
  /**
   * For a single session on Android, open the system calendar's editor so
   * the user reviews and saves the event there; falls back to the chosen
   * calendar when no calendar app can open it.
   */
  systemEditor?: boolean;
}

interface PendingExport {
  sessions: CalendarSession[];
  skipped: number;
}

function calendarErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to add sessions to calendar.";
}

/** The mapped error `createCalendarEventWithSystemUI` throws when no app can open the editor. */
function isSystemEditorUnavailable(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Could not open the Android calendar app");
}

/**
 * The one "Add to Calendar" flow for the Saved tab, the Start List and the
 * session details: permission, then the default calendar on iOS; on Android
 * the remembered calendar, else a picker (`picker`, rendered by the caller
 * with `CalendarDestinationPickerModal`). Writes go through
 * `createCalendarEventsToCalendar`, which updates events MeetCal already
 * added instead of duplicating them, and the toast reports partial results.
 * The caller runs the sign-in and subscription gates first.
 */
export function useCalendarSessionsExport() {
  const [destinations, setDestinations] = useState<CalendarDestination[]>([]);
  const [pending, setPending] = useState<PendingExport | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const writeSessions = useCallback(
    async (sessions: CalendarSession[], skipped: number, systemEditor: boolean) => {
      try {
        const hasPermission = await requestCalendarPermissions();
        if (!hasPermission) {
          Alert.alert(
            "Permission Required",
            "Calendar permission is required to add sessions.",
          );
          return;
        }

        if (Platform.OS !== "android") {
          const result = await createCalendarEvents(sessions);
          showToast(describeCalendarWrite(result, { skipped }));
          return;
        }

        if (systemEditor && sessions.length === 1) {
          try {
            await createCalendarEventWithSystemUI(sessions[0]);
            showToast({
              type: "info",
              message: "Review the event in your calendar app and save it there.",
            });
            return;
          } catch (error) {
            if (!isSystemEditorUnavailable(error)) throw error;
          }
        }

        const preferredCalendar = await resolvePreferredAndroidCalendar();
        if (preferredCalendar) {
          const result = await createCalendarEventsToCalendar(sessions, preferredCalendar.id);
          showToast(
            describeCalendarWrite(result, { skipped, calendarTitle: preferredCalendar.title }),
          );
          return;
        }

        const writableCalendars = await getWritableCalendars();
        if (writableCalendars.length === 0) {
          Alert.alert(
            "No Calendars Found",
            "Add a calendar account on this device before saving sessions.",
          );
          return;
        }

        setDestinations(writableCalendars);
        setPending({ sessions, skipped });
      } catch (error) {
        showToast({ type: "error", message: calendarErrorMessage(error) });
        console.error(error);
      }
    },
    [],
  );

  /** Adds `sessions` (after a confirmation unless `confirm: false`). */
  const exportSessions = useCallback(
    (sessions: CalendarSession[], options: CalendarExportOptions = {}) => {
      const { skipped = 0, confirm = true, systemEditor = false } = options;
      if (sessions.length === 0) {
        showToast(
          skipped > 0
            ? {
                type: "error",
                message: "These sessions have no schedule details to add to your calendar yet.",
              }
            : { type: "info", message: "There are no sessions to add to calendar." },
        );
        return;
      }
      if (!confirm) {
        void writeSessions(sessions, skipped, systemEditor);
        return;
      }
      Alert.alert(
        "Add to Calendar",
        `Add ${sessions.length} session${sessions.length === 1 ? "" : "s"} to your calendar?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Add", onPress: () => void writeSessions(sessions, skipped, systemEditor) },
        ],
      );
    },
    [writeSessions],
  );

  const onSelect = useCallback(
    async (destination: CalendarDestination) => {
      if (!pending?.sessions.length) {
        setPending(null);
        return;
      }

      setIsLoading(true);
      try {
        await setPreferredAndroidCalendarId(destination.id);
        const result = await createCalendarEventsToCalendar(pending.sessions, destination.id);
        setPending(null);
        showToast(
          describeCalendarWrite(result, {
            skipped: pending.skipped,
            calendarTitle: destination.title,
          }),
        );
      } catch (error) {
        console.error("Calendar export: failed to write calendar events", error);
        showToast({ type: "error", message: calendarErrorMessage(error) });
      } finally {
        setIsLoading(false);
      }
    },
    [pending],
  );

  const onClose = useCallback(() => {
    setPending(null);
  }, []);

  return {
    exportSessions,
    picker: { visible: pending !== null, destinations, isLoading, onClose, onSelect },
  };
}
