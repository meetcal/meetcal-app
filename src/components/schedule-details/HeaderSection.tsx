import { PlatformBadge } from "@/components/schedule-details/PlatformBadge";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { showToast } from "@/components/ui/Toast";
import { useSavedSessions } from "@/contexts/SavedSessionsContext";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { useAppColors } from "@/hooks/useAppColors";
import { useRequirePremium } from "@/hooks/useRequirePremium";
import { hasCalendarTimes } from "@/lib/calendar-export";
import { requestReviewAfterFirstSave } from "@/lib/review-prompt";
import { DaySchedule, Session } from "@/types/schedule";
import { HeaderSectionProps } from "@/types/schedule-details";
import { CalendarDestinationPickerModal } from "@/components/calendar/CalendarDestinationPickerModal";
import { useCalendarSessionsExport } from "@/hooks/useCalendarSessionsExport";
import {
  createSessionDetailsDeepLink,
  normalizeDeepLinkHref,
} from "@/utils/deepLinks";
import { meetTimeZoneLabel } from "@/utils/timezone";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Palette } from "@/constants/Palette";

const HeaderSection: React.FC<HeaderSectionProps> = ({
  sessionNumber,
  platform,
  weightClass,
  meet,
  currentSchedule,
  sessionId,
  sessionWeightClass,
  platformStartTime,
  platformWeighInTime,
  sessionFullDate,
  athleteName,
}) => {
  const router = useRouter();
  const colors = useAppColors();
  const { saveSession, removeSession, isSessionSaved } = useSavedSessions();
  const { meetDetails, availableMeets } = useSelectedMeet();
  const { requirePremium, requireCalendarExport, requireAuth, access } = useRequirePremium();
  const isSubscribed = access === "granted";
  const calendarExport = useCalendarSessionsExport();

  // `meetDetails` is the *selected* meet, not necessarily this one: the saved
  // tab, the next-session card and calendar / reminder deep links all open
  // sessions from other meets. Match by name, falling back to the same mapped
  // list the picker uses. No label (details not loaded yet) beats a
  // confidently wrong one; it is read at this session's own date, so a meet
  // that spans a DST change labels each day with its own zone.
  const timeZoneAbbr = useMemo(() => {
    const details =
      meetDetails?.name === meet
        ? meetDetails
        : availableMeets.find((candidate) => candidate.name === meet);
    return meetTimeZoneLabel(details?.time, sessionFullDate);
  }, [meetDetails, availableMeets, meet, sessionFullDate]);

  // Use the generated sessionId instead of params.id
  const isSaved = isSessionSaved(sessionId);

  const showSaveAlert = (action: "save" | "remove") => {
    const message =
      action === "save"
        ? `Session ${sessionNumber} saved to your list`
        : `Session ${sessionNumber} removed from your list`;

    showToast({ type: "success", message });
  };

  // Where sign-in and the paywall send the user back to. The bare route path
  // used to be passed, so the return landed on a details screen with no
  // meet, session or platform and rendered blank.
  const returnPath = useMemo(() => {
    const href = normalizeDeepLinkHref(
      createSessionDetailsDeepLink({
        meet,
        sessionNumber: Number(sessionNumber),
        platform,
      }),
    );
    return typeof href === "string" ? href : "/shared-screens/schedule-details";
  }, [meet, sessionNumber, platform]);

  const handleSavePress = async () => {
    // Check authentication first
    const authResult = requireAuth({
      feature: "save-session",
      message: "Sign in to save sessions and sync them across your devices.",
      returnPath,
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
      void requestReviewAfterFirstSave();
    }
  };

  const addToCalendar = () => {
    // The same sign-in and subscription gate as the Saved tab and the Start
    // List; this button used to write the event with no gate at all.
    if (!requireCalendarExport(returnPath)) return;

    if (!hasCalendarTimes(sessionFullDate, platformStartTime)) {
      showToast({
        type: "info",
        message: "This session has no scheduled time yet to add to your calendar.",
      });
      return;
    }

    // On Android a single session opens the calendar app's editor, so the
    // user reviews it there; elsewhere it is written (or updated, if MeetCal
    // added it before) in the default calendar.
    calendarExport.exportSessions(
      [
        {
          date: sessionFullDate,
          startTime: platformStartTime,
          weighInTime: platformWeighInTime,
          sessionNumber: sessionNumber,
          platform: platform,
          weightClass: sessionWeightClass,
          meet: meet,
        },
      ],
      { confirm: false, systemEditor: true },
    );
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
          {timeZoneAbbr ? ` ${timeZoneAbbr}` : ""}
        </ThemedText>
      </View>

      <View style={[styles.section, { borderBottomColor: colors.border }]}>
        <View style={styles.platformWeightRow}>
          <PlatformBadge platform={platform} />
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
              !isSubscribed && styles.premiumButtonDisabled,
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => {
              if (
                !requirePremium({
                  feature: "qualifying-totals",
                  message: "Sign in to access premium features.",
                  returnPath,
                })
              ) {
                return;
              }
              // The screen reads only event / gender / age group, and
              // neither a meet name nor a (mixed) session maps reliably onto
              // its event options, so it opens on its defaults.
              router.push("/comp-data/new-qualifying-totals");
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
              if (
                !requirePremium({
                  feature: "attempt-estimator",
                  message: "Sign in to access premium features.",
                  returnPath,
                })
              ) {
                return;
              }
              router.push({
                pathname: "/shared-screens/attempt-estimator",
                params: {
                  sessionNumber: sessionNumber,
                  platform: platform,
                  meet: meet,
                },
              });
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
      <CalendarDestinationPickerModal
        visible={calendarExport.picker.visible}
        title="Choose Calendar"
        destinations={calendarExport.picker.destinations}
        onClose={calendarExport.picker.onClose}
        onSelect={(destination) => {
          void calendarExport.picker.onSelect(destination);
        }}
        isLoading={calendarExport.picker.isLoading}
      />
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
  saveButton: {
    backgroundColor: Palette.systemBlue,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    flex: 1,
  },
  saveButtonPressed: {
    opacity: 0.8,
  },
  saveButtonText: {
    color: Palette.white,
    fontSize: 15,
    fontWeight: "600",
  },
  calendarButton: {
    backgroundColor: Palette.systemGreen, // iOS green
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    flex: 1,
  },
  calendarButtonPressed: {
    opacity: 0.8,
  },
  calendarButtonText: {
    color: Palette.white,
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
