import { PlatformBadge } from "@/components/schedule-details/PlatformBadge";
import { ThemedText } from "@/components/ThemedText";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { useSavedSessions } from "@/contexts/SavedSessionsContext";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import {
  convertToUTC,
  formatTimeWithZone,
  getMeetConfig,
  getMeetVenueLocation,
} from "@/data/meets/config";
import { Platform as PlatformType } from "@/data/types/athletes";
import { MeetName } from "@/data/types/meet";
import { useAppColors } from "@/hooks/useAppColors";
import { DaySchedule, Schedule, Session } from "@/types/schedule";
import { useAuthGuard } from "@/utils/authGuard";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Calendar from "expo-calendar";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import * as StoreReview from "expo-store-review";
import React, { useEffect, useMemo, useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, View } from "react-native";

// Update interface names
interface SessionPlatformDetails {
  platform: string;
  platformStartTime?: string;
  weightClass?: string;
}

interface HeaderSectionProps {
  sessionNumber: string;
  platform: string;
  weightClass: string;
  startTime: string;
  meet: MeetName;
  currentSchedule: Schedule;
  sessionId: string;
  sessionDate: string;
  sessionWeightClass: string;
  platformStartTime: string;
  platformWeighInTime: string;
  athleteName?: string;
}

function calculateWeighInTime(startTime: string): string {
  const [time, period] = startTime.split(" ");
  const [hours, minutes] = time.split(":").map(Number);

  // Convert to 24 hour format
  let hour24 = hours;
  if (period === "PM" && hours !== 12) hour24 += 12;
  if (period === "AM" && hours === 12) hour24 = 0;

  // Subtract 2 hours
  let weighInHour = hour24 - 2;

  // Handle day wrap
  if (weighInHour < 0) weighInHour += 24;

  // Convert back to 12 hour format
  let weighInPeriod = "AM";
  if (weighInHour >= 12) {
    weighInPeriod = "PM";
    if (weighInHour > 12) weighInHour -= 12;
  }
  if (weighInHour === 0) weighInHour = 12;

  return `${weighInHour}:${minutes.toString().padStart(2, "0")} ${weighInPeriod}`;
}

const HeaderSection: React.FC<HeaderSectionProps> = ({
  sessionNumber,
  platform,
  weightClass,
  startTime,
  meet,
  currentSchedule,
  sessionId,
  sessionDate,
  sessionWeightClass,
  platformStartTime,
  platformWeighInTime,
  athleteName,
}) => {
  const [hasCalendarPermission, setHasCalendarPermission] = useState(false);
  const router = useRouter();
  const colors = useAppColors();
  const { saveSession, removeSession, isSessionSaved } = useSavedSessions();
  const { meetDetails } = useSelectedMeet();
  const { isSubscribed } = useSubscription();
  const { requireAuth } = useAuthGuard();

  // Get time zone abbreviation
  const timeZoneAbbr = useMemo(() => {
    const timeZoneId = meetDetails?.time.timeZoneIdentifier || "America/Denver";
    const date = new Date();
    return (
      new Intl.DateTimeFormat("en-US", {
        timeZone: timeZoneId,
        timeZoneName: "short",
      })
        .formatToParts(date)
        .find((part) => part.type === "timeZoneName")?.value || ""
    );
  }, [meetDetails?.time.timeZoneIdentifier]);

  // Use the generated sessionId instead of params.id
  const isSaved = isSessionSaved(sessionId);

  useEffect(() => {
    (async () => {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      setHasCalendarPermission(status === "granted");
    })();
  }, []);

  const showSaveAlert = (action: "save" | "remove") => {
    const title = action === "save" ? "Session Saved" : "Session Unsaved";
    let message =
      action === "save"
        ? `Session ${sessionNumber} - ${platform} - ${sessionWeightClass} has been saved to your list`
        : `Session ${sessionNumber} - ${platform} - ${sessionWeightClass} has been unsaved from your list`;

    Alert.alert(title, message, [{ text: "OK" }], {
      userInterfaceStyle: "light",
    });
  };

  const handleSavePress = async () => {
    // Check authentication first
    const authResult = requireAuth({
      feature: "save-session",
      message: "Sign in to save sessions and sync them across your devices.",
      returnPath: "/shared-screens/schedule-details",
    });
    if (authResult === null || authResult === false) {
      return;
    }

    if (isSaved) {
      const removed = await removeSession(sessionId);
      if (!removed) {
        Alert.alert(
          "Error",
          "Failed to remove saved session. Please try again.",
        );
        return;
      }
      showSaveAlert("remove");
    } else {
      // Find the session day in the current schedule
      const sessionDay = currentSchedule.find((day: DaySchedule) =>
        day.sessions.some((s: Session) => s.number === parseInt(sessionNumber)),
      );

      if (!sessionDay) {
        console.error("Session day not found in schedule");
        return;
      }

      const saved = await saveSession({
        id: sessionId,
        sessionNumber: Number(sessionNumber),
        platform: platform,
        weightClass: sessionWeightClass || weightClass,
        startTime: platformStartTime,
        weighInTime: platformWeighInTime,
        date: sessionDay.fullDate,
        athleteNames: athleteName ? [athleteName] : undefined,
        meet: meet,
      });
      if (!saved) {
        Alert.alert("Error", "Failed to save session. Please try again.");
        return;
      }
      showSaveAlert("save");
      checkAndShowReviewPrompt();
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const checkAndShowReviewPrompt = async () => {
    try {
      const hasShownReview = await AsyncStorage.getItem("hasShownReview");
      const hasSavedBefore = await AsyncStorage.getItem("hasSavedBefore");

      if (!hasSavedBefore && !hasShownReview) {
        // Mark that user has saved a session
        await AsyncStorage.setItem("hasSavedBefore", "true");
        // Use native store review prompt
        try {
          const isAvailable = await StoreReview.isAvailableAsync();
          if (isAvailable) {
            await StoreReview.requestReview();
          }
        } catch (error) {
          console.warn("ScheduleDetails: Store review unavailable", error);
        }
        await AsyncStorage.setItem("hasShownReview", "true");
      }
    } catch (error) {
      console.error("Error checking review status:", error);
    }
  };

  const showSuccessAlert = () => {
    Alert.alert(
      "Added to Calendar",
      `Session ${sessionNumber} - ${platform} - ${sessionWeightClass} has been added to your calendar`,
      [{ text: "OK" }],
      { userInterfaceStyle: "light" },
    );
  };

  const addToCalendar = async () => {
    if (!hasCalendarPermission) {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Calendar Permission Required",
          "Please enable calendar access in your device settings to add events.",
          [{ text: "OK" }],
          { userInterfaceStyle: "light" },
        );
        return;
      }
      setHasCalendarPermission(true);
    }

    // Find the session and get platform-specific time
    const sessionDay = currentSchedule.find((day: DaySchedule) =>
      day.sessions.some(
        (session: Session) =>
          session.number === parseInt(sessionNumber) &&
          session.platforms.some(
            (p: SessionPlatformDetails) => p.platform === platform,
          ),
      ),
    );

    if (!sessionDay) {
      console.error("Session day not found:", {
        sessionNumber,
        platform,
      });
      Alert.alert(
        "Error",
        "Could not find session details. Please try again.",
        [{ text: "OK" }],
        { userInterfaceStyle: "light" },
      );
      return;
    }

    try {
      // Get meet config first
      const meetConfig = await getMeetConfig(meet);

      // Use platform-specific start time if available, otherwise use session start time
      const session = sessionDay.sessions.find(
        (s) => s.number === parseInt(sessionNumber),
      );
      const platformData = session?.platforms.find(
        (p) => p.platform === platform,
      );
      const startTimeToUse = platformData?.platformStartTime || startTime;
      const weighInTime = calculateWeighInTime(startTimeToUse);

      // Convert times to UTC using the meet's time zone
      const startDate = convertToUTC(startTimeToUse, sessionDay.fullDate, meet);
      const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);

      const eventDetails = {
        title: `Session ${sessionNumber} - Platform ${platform}`,
        location: getMeetVenueLocation(meet),
        notes: `Weight Class: ${sessionWeightClass}\nWeigh-in Time: ${formatTimeWithZone(weighInTime, meet)}`,
        startDate: startDate,
        endDate: endDate,
        timeZone: meetConfig.time.timeZoneIdentifier,
        alarms: [
          {
            relativeOffset: -60,
          },
        ],
      };

      let calendarId;

      if (Platform.OS === "ios") {
        const calendar = await Calendar.getDefaultCalendarAsync();
        calendarId = calendar.id;
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

      await Calendar.createEventAsync(calendarId, eventDetails);
      showSuccessAlert();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error("Error creating calendar event:", error);

      const errorMessage = Platform.select({
        ios: "Could not add event to calendar. Please try again.",
        android:
          "Could not add event to calendar. Please make sure you have a calendar app installed and try again.",
        default: "Could not add event to calendar. Please try again.",
      });

      Alert.alert("Error", errorMessage, [{ text: "OK" }], {
        userInterfaceStyle: "light",
      });
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <View style={[styles.section, { borderBottomColor: colors.border }]}>
        <ThemedText style={[styles.sessionSummary, { color: colors.text }]}>
          Session {sessionNumber} • {platformStartTime} {timeZoneAbbr}
        </ThemedText>
      </View>

      <View style={[styles.section, { borderBottomColor: colors.border }]}>
        <View style={styles.platformWeightRow}>
          <PlatformBadge platform={platform as PlatformType} />
          <ThemedText style={[styles.inlineValue, { color: colors.text }]}>
            {sessionWeightClass}
          </ThemedText>
        </View>
      </View>

      <View style={styles.buttonContainer}>
        <Pressable
          style={({ pressed }) => [
            styles.saveButton,
            pressed && styles.saveButtonPressed,
          ]}
          onPress={handleSavePress}
        >
          <ThemedText style={styles.saveButtonText}>
            {isSaved ? "Unsave Session" : "Save Session"}
          </ThemedText>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.calendarButton,
            pressed && styles.calendarButtonPressed,
          ]}
          onPress={addToCalendar}
        >
          <ThemedText style={styles.calendarButtonText}>
            Add to Calendar
          </ThemedText>
        </Pressable>
      </View>

      <View
        style={[
          styles.section,
          styles.lastSection,
          styles.sectionTopDivider,
          { borderTopColor: colors.border },
        ]}
      >
        <View style={styles.premiumButtonsRow}>
          <Pressable
            style={({ pressed }) => [
              styles.premiumButton,
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => {
              const authResult = requireAuth({
                feature: "qualifying-totals",
                message: "Sign in to access premium features.",
                returnPath: "/shared-screens/schedule-details",
              });
              if (authResult === null || authResult === false) {
                return;
              }
              if (isSubscribed) {
                router.push({
                  pathname: "/comp-data/new-qualifying-totals",
                  params: {
                    sessionNumber: sessionNumber,
                    platform: platform,
                    meet: meet,
                  },
                });
              } else {
                router.push({
                  pathname: "/shared-screens/paywall",
                  params: {
                    from: "/shared-screens/schedule-details",
                    feature: "qualifying-totals",
                  },
                } as any);
              }
            }}
          >
            <ThemedText
              style={[styles.premiumButtonText, { color: colors.text }]}
            >
              Qualifying Totals
            </ThemedText>
            <IconSymbol name="chevron.right" size={13} color={colors.link} />
          </Pressable>

          <View
            style={[styles.verticalDivider, { backgroundColor: colors.border }]}
          />

          <Pressable
            style={({ pressed }) => [
              styles.premiumButton,
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => {
              const authResult = requireAuth({
                feature: "attempt-estimator",
                message: "Sign in to access premium features.",
                returnPath: "/shared-screens/schedule-details",
              });
              if (authResult === null || authResult === false) {
                return;
              }
              if (isSubscribed) {
                router.push({
                  pathname: "/shared-screens/attempt-estimator",
                  params: {
                    sessionNumber: sessionNumber,
                    platform: platform,
                    meet: meet,
                  },
                });
              } else {
                router.push({
                  pathname: "/shared-screens/paywall",
                  params: {
                    from: "/shared-screens/schedule-details",
                    feature: "attempt-estimator",
                  },
                } as any);
              }
            }}
          >
            <ThemedText
              style={[styles.premiumButtonText, { color: colors.text }]}
            >
              Attempt Estimator
            </ThemedText>
            <IconSymbol name="chevron.right" size={13} color={colors.link} />
          </Pressable>
        </View>
      </View>
    </View>
  );
};

export default HeaderSection;

const styles = StyleSheet.create({
  card: {
    borderRadius: 10,
    marginBottom: 16,
    overflow: "hidden",
  },
  section: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sessionSummary: {
    fontSize: 17,
    fontWeight: "600",
  },
  platformWeightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  inlineValue: {
    fontSize: 15,
    fontWeight: "500",
  },
  buttonContainer: {
    padding: 16,
    gap: 12,
    flexDirection: "row",
  },
  saveButton: {
    backgroundColor: "#007AFF",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    flex: 1,
  },
  saveButtonPressed: {
    opacity: 0.8,
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
  calendarButton: {
    backgroundColor: "#34C759", // iOS green
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    flex: 1,
  },
  calendarButtonPressed: {
    opacity: 0.8,
  },
  calendarButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
  lastSection: {
    borderBottomWidth: 0,
  },
  sectionTopDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  premiumButtonsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  premiumButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
  },
  premiumButtonText: {
    fontSize: 15,
    flex: 1,
  },
  verticalDivider: {
    width: 1,
    height: 24,
    marginHorizontal: 8,
  },
});
