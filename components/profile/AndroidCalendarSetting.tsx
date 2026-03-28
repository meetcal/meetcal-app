import { CalendarDestinationPickerModal } from "@/components/calendar/CalendarDestinationPickerModal";
import {
  clearPreferredAndroidCalendarId,
  getWritableCalendars,
  requestCalendarPermissions,
  resolvePreferredAndroidCalendar,
  setPreferredAndroidCalendarId,
  type CalendarDestination,
} from "@/utils/calendar";
import React, { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import { ProfileActionSetting } from "./ProfileActionSetting";

interface AndroidCalendarSettingProps {
  colors: {
    text: string;
    secondaryText: string;
    border: string;
    card: string;
    pressed: string;
    link: string;
    fail: string;
  };
}

export function AndroidCalendarSetting({
  colors,
}: AndroidCalendarSettingProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isPickerVisible, setIsPickerVisible] = useState(false);
  const [isPickerLoading, setIsPickerLoading] = useState(false);
  const [selectedCalendar, setSelectedCalendar] =
    useState<CalendarDestination | null>(null);
  const [destinations, setDestinations] = useState<CalendarDestination[]>([]);

  const loadSelectedCalendar = useCallback(async () => {
    try {
      const resolvedCalendar = await resolvePreferredAndroidCalendar();
      setSelectedCalendar(resolvedCalendar);
    } catch (error) {
      console.error("Profile: failed to load preferred Android calendar", error);
      setSelectedCalendar(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSelectedCalendar();
  }, [loadSelectedCalendar]);

  const loadDestinations = useCallback(async () => {
    setIsPickerLoading(true);

    try {
      const hasPermission = await requestCalendarPermissions();
      if (!hasPermission) {
        Alert.alert(
          "Permission Required",
          "Calendar permission is required to choose a default calendar.",
        );
        return;
      }

      const nextDestinations = await getWritableCalendars();
      if (nextDestinations.length === 0) {
        Alert.alert(
          "No Calendars Found",
          "Add a calendar account on this device before choosing a default calendar.",
        );
        return;
      }

      setDestinations(nextDestinations);
      setIsPickerVisible(true);
    } catch (error) {
      console.error("Profile: failed to load writable calendars", error);
      Alert.alert(
        "Error",
        "Could not load your device calendars. Please try again.",
      );
    } finally {
      setIsPickerLoading(false);
    }
  }, []);

  const handleSelect = useCallback(async (destination: CalendarDestination) => {
    try {
      await setPreferredAndroidCalendarId(destination.id);
      setSelectedCalendar(destination);
      setIsPickerVisible(false);
    } catch (error) {
      console.error("Profile: failed to save preferred Android calendar", error);
      Alert.alert(
        "Error",
        "Could not save the selected calendar. Please try again.",
      );
    }
  }, []);

  const handleClear = useCallback(async () => {
    try {
      await clearPreferredAndroidCalendarId();
      setSelectedCalendar(null);
      setIsPickerVisible(false);
    } catch (error) {
      console.error("Profile: failed to clear preferred Android calendar", error);
      Alert.alert(
        "Error",
        "Could not clear the selected calendar. Please try again.",
      );
    }
  }, []);

  return (
    <React.Fragment>
      <ProfileActionSetting
        colors={colors}
        label="Default Calendar"
        value={isLoading ? "Loading..." : selectedCalendar?.title || "Not set"}
        onPress={() => {
          void loadDestinations();
        }}
        disabled={isLoading || isPickerLoading}
      />

      <CalendarDestinationPickerModal
        visible={isPickerVisible}
        title="Default Calendar"
        destinations={destinations}
        selectedId={selectedCalendar?.id}
        onClose={() => setIsPickerVisible(false)}
        onSelect={(destination) => {
          void handleSelect(destination);
        }}
        onClear={selectedCalendar ? () => void handleClear() : undefined}
        isLoading={isPickerLoading}
      />
    </React.Fragment>
  );
}
