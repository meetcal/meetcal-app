import { PlatformBadge } from "@/components/schedule-details/PlatformBadge";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { showToast } from "@/components/ui/Toast";
import { useSavedSessions } from "@/contexts/SavedSessionsContext";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { Platform as PlatformType } from "@/data/types/athletes";
import { useAppColors } from "@/hooks/useAppColors";
import { DaySchedule, Session } from "@/types/schedule";
import { HeaderSectionProps, SessionPlatformDetails } from "@/types/schedule-details";
import { useAuthGuard } from "@/utils/authGuard";
import {
  createCalendarEventWithSystemUI,
  createCalendarEventsToCalendar,
  requestCalendarPermissions,
  resolvePreferredAndroidCalendar,
} from "@/utils/calendar";
import { calculateWeighInTime } from "@/utils/time";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import * as StoreReview from "expo-store-review";
import React, { useEffect, useMemo, useRef } from "react";
import { Alert, Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from "react-native-reanimated";

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

  // Bounce the save button whenever the saved state flips (not on first mount).
  const saveScale = useSharedValue(1);
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    saveScale.value = withSequence(
      withSpring(1.12, { damping: 12, stiffness: 320 }),
      withSpring(1, { damping: 14, stiffness: 300 }),
    );
  }, [isSaved, saveScale]);
  const saveAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: saveScale.value }],
  }));

  const showSaveAlert = (action: "save" | "remove") => {
    const message =
      action === "save"
        ? `Session ${sessionNumber} saved to your list`
        : `Session ${sessionNumber} removed from your list`;

    showToast({ type: "success", message });
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
        showToast({
          type: "error",
          message: "Failed to remove saved session. Please try again.",
        });
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
        showToast({
          type: "error",
          message: "Unable to save: session not found. Please try again.",
        });
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
        showToast({
          type: "error",
          message: "Failed to save session. Please try again.",
        });
        return;
      }
      showSaveAlert("save");
      checkAndShowReviewPrompt();
    }
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
            await AsyncStorage.setItem("hasShownReview", "true");
          }
        } catch (error) {
          console.warn("ScheduleDetails: Store review unavailable", error);
        }
      }
    } catch (error) {
      console.error("Error checking review status:", error);
    }
  };

  const showSuccessAlert = (openedSystemCalendar = false) => {
    if (Platform.OS === "android" && openedSystemCalendar) {
      showToast({
        type: "info",
        message: "Review the event in your calendar app and save it there.",
      });
      return;
    }

    showToast({
      type: "success",
      message: `Session ${sessionNumber} added to your calendar`,
    });
  };

  const addToCalendar = async () => {
    const hasPermission = await requestCalendarPermissions();
    if (!hasPermission) {
      Alert.alert(
        "Calendar Permission Required",
        "Please enable calendar access in your device settings to add events.",
        [{ text: "OK" }],
        { userInterfaceStyle: "light" },
      );
      return;
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
      showToast({
        type: "error",
        message: "Could not find session details. Please try again.",
      });
      return;
    }

    try {
      // Use platform-specific start time if available, otherwise use session start time
      const session = sessionDay.sessions.find(
        (s) => s.number === parseInt(sessionNumber),
      );
      const platformData = session?.platforms.find(
        (p) => p.platform === platform,
      );
      const startTimeToUse = platformData?.platformStartTime || startTime;
      const weighInTime = platformWeighInTime || calculateWeighInTime(startTimeToUse);

      const calendarSession = {
        date: sessionDay.fullDate,
        startTime: startTimeToUse,
        weighInTime: weighInTime,
        sessionNumber: sessionNumber,
        platform: platform,
        weightClass: sessionWeightClass,
        meet: meet,
      };

      let openedSystemCalendar = false;
      if (Platform.OS === "android") {
        try {
          await createCalendarEventWithSystemUI(calendarSession);
          openedSystemCalendar = true;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "";
          if (!errorMessage.includes("Could not open the Android calendar app")) {
            throw error;
          }

          const preferredCalendar = await resolvePreferredAndroidCalendar();
          if (!preferredCalendar) {
            throw error;
          }

          await createCalendarEventsToCalendar(
            [calendarSession],
            preferredCalendar.id,
          );
        }
      } else {
        await createCalendarEventWithSystemUI(calendarSession);
      }

      showSuccessAlert(openedSystemCalendar);
    } catch (error) {
      console.error("Error creating calendar event:", error);

      const errorMessage =
        error instanceof Error
          ? error.message
          : Platform.select({
              ios: "Could not add event to calendar. Please try again.",
              android:
                "Could not add event to calendar. Please make sure you have a calendar app installed and try again.",
              default: "Could not add event to calendar. Please try again.",
            });

      showToast({
        type: "error",
        message: errorMessage ?? "Could not add event to calendar.",
      });
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <View style={[styles.section, { borderBottomColor: colors.border }]}>
        <ThemedText style={[styles.sessionSummary, { color: colors.text }]}>
          Session{" "}
          {sessionNumber}
          {" "}
          •{" "}
          {platformStartTime}
          {" "}
          {timeZoneAbbr}
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
        <Animated.View style={[styles.saveButtonWrapper, saveAnimatedStyle]}>
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
        </Animated.View>

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
              !isSubscribed && styles.premiumButtonDisabled,
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
              if (isSubscribed === true) {
                router.push({
                  pathname: "/comp-data/new-qualifying-totals",
                  params: {
                    sessionNumber: sessionNumber,
                    platform: platform,
                    meet: meet,
                  },
                });
              } else if (isSubscribed === false) {
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
              style={[
                styles.premiumButtonText,
                { color: isSubscribed ? colors.text : colors.secondaryText },
              ]}
            >
              Qualifying Totals
            </ThemedText>
            <IconSymbol
              name="chevron.right"
              size={13}
              color={isSubscribed ? colors.link : colors.secondaryText}
            />
          </Pressable>

          <View
            style={[styles.verticalDivider, { backgroundColor: colors.border }]}
          />

          <Pressable
            style={({ pressed }) => [
              styles.premiumButton,
              !isSubscribed && styles.premiumButtonDisabled,
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
              if (isSubscribed === true) {
                router.push({
                  pathname: "/shared-screens/attempt-estimator",
                  params: {
                    sessionNumber: sessionNumber,
                    platform: platform,
                    meet: meet,
                  },
                });
              } else if (isSubscribed === false) {
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
              style={[
                styles.premiumButtonText,
                { color: isSubscribed ? colors.text : colors.secondaryText },
              ]}
            >
              Attempt Estimator
            </ThemedText>
            <IconSymbol
              name="chevron.right"
              size={13}
              color={isSubscribed ? colors.link : colors.secondaryText}
            />
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
    gap: 12,
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
  saveButtonWrapper: {
    flex: 1,
  },
  saveButton: {
    backgroundColor: "#007AFF",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  saveButtonPressed: {
    opacity: 0.8,
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
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
    fontSize: 15,
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
  premiumButtonDisabled: {
    opacity: 0.55,
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
