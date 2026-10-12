import { useCallback, useState } from "react";
import { Alert, Platform } from "react-native";

import { showToast } from "@/components/ui/Toast";
import {
  type CalendarDestination,
  type CalendarSession,
  createCalendarEvents,
  createCalendarEventsToCalendar,
  getWritableCalendars,
  requestCalendarPermissions,
  resolvePreferredAndroidCalendar,
  setPreferredAndroidCalendarId,
} from "@/utils/calendar";

function calendarErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to add sessions to calendar.";
}

/**
 * Adds a batch of sessions to the device calendar after a confirmation:
 * the system calendar on iOS; on Android the remembered calendar, else a
 * picker (`picker`, rendered by the caller with
 * `CalendarDestinationPickerModal`). Moved out of the Start List screen
 * unchanged; the caller runs the sign-in and subscription gates first.
 */
export function useCalendarSessionsExport() {
  const [destinations, setDestinations] = useState<CalendarDestination[]>([]);
  const [pendingSessions, setPendingSessions] = useState<CalendarSession[] | null>(null);
  const [visible, setVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const writeSessions = useCallback(async (sessions: CalendarSession[]) => {
    try {
      const hasPermission = await requestCalendarPermissions();
      if (!hasPermission) {
        Alert.alert(
          "Permission Required",
          "Calendar permission is required to add sessions.",
        );
        return;
      }

      if (Platform.OS === "android") {
        const preferredCalendar = await resolvePreferredAndroidCalendar();
        if (preferredCalendar) {
          await createCalendarEventsToCalendar(sessions, preferredCalendar.id);
          showToast({
            type: "success",
            message: `Sessions added to ${preferredCalendar.title}.`,
          });
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
        setPendingSessions(sessions);
        setVisible(true);
        return;
      }

      await createCalendarEvents(sessions);
      showToast({
        type: "success",
        message: "Sessions have been added to your calendar.",
      });
    } catch (error) {
      showToast({ type: "error", message: calendarErrorMessage(error) });
      console.error(error);
    }
  }, []);

  /** Confirms, then adds `sessions`; an empty batch only shows a toast. */
  const exportSessions = useCallback(
    (sessions: CalendarSession[]) => {
      if (sessions.length === 0) {
        showToast({ type: "info", message: "There are no sessions to add to calendar." });
        return;
      }
      Alert.alert(
        "Add to Calendar",
        `Add ${sessions.length} session${sessions.length === 1 ? "" : "s"} to your calendar?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Add", onPress: () => void writeSessions(sessions) },
        ],
      );
    },
    [writeSessions],
  );

  const onSelect = useCallback(
    async (destination: CalendarDestination) => {
      if (!pendingSessions?.length) {
        setVisible(false);
        return;
      }

      setIsLoading(true);
      try {
        await setPreferredAndroidCalendarId(destination.id);
        await createCalendarEventsToCalendar(pendingSessions, destination.id);
        setVisible(false);
        setPendingSessions(null);
        showToast({
          type: "success",
          message: `Sessions added to ${destination.title}.`,
        });
      } catch (error) {
        console.error("StartList: failed to write calendar events", error);
        showToast({ type: "error", message: calendarErrorMessage(error) });
      } finally {
        setIsLoading(false);
      }
    },
    [pendingSessions],
  );

  const onClose = useCallback(() => {
    setVisible(false);
    setPendingSessions(null);
  }, []);

  return {
    exportSessions,
    picker: { visible, destinations, isLoading, onClose, onSelect },
  };
}
