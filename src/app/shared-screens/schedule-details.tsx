import HeaderSection from "@/components/schedule-details/HeaderSection";
import SessionAthletes from "@/components/schedule-details/SessionAthletes";
import { showToast } from "@/components/ui/Toast";
import { ThemedView } from "@/components/ui/ThemedView";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { MeetName } from "@/data/types/meet";
import { useAppColors } from "@/hooks/useAppColors";
import { useSessionAthletes } from "@/hooks/useMeetAthletes";
import { useScheduleData } from "@/hooks/useScheduleData";
import { findSessionPlatform } from "@/lib/schedule-lookup";
import { generateSessionId } from "@/utils/session";
import { calculateWeighInTime } from "@/utils/time";
import { Stack, useLocalSearchParams } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";

const REFRESH_FAILED_MESSAGE = "Failed to refresh session athletes. Please try again.";

export default function SessionDetailsScreen() {
  const screenInsets = useScreenHorizontalInsets();
  const colors = useAppColors();
  const { selectedMeet } = useSelectedMeet();
  const [refreshing, setRefreshing] = useState(false);

  const rawParams = useLocalSearchParams<{
    id?: string;
    sessionNumber?: string;
    platform?: string;
    weightClass?: string;
    startTime?: string;
    weighInTime?: string;
    date?: string;
    athleteName?: string;
    meet?: MeetName;
  }>();

  // Ensure required params have values
  const params = {
    id: rawParams.id || "",
    sessionNumber: rawParams.sessionNumber || "",
    platform: rawParams.platform || "",
    weightClass: rawParams.weightClass || "",
    startTime: rawParams.startTime || "",
    weighInTime: rawParams.weighInTime || "",
    date: rawParams.date || "",
    athleteName: rawParams.athleteName,
    meet: rawParams.meet || selectedMeet || "",
  };

  const parsedSessionNumber = params.sessionNumber
    ? parseInt(params.sessionNumber, 10)
    : NaN;
  const {
    schedule: currentSchedule,
    refreshSchedule,
  } = useScheduleData((params.meet || null) as MeetName | null);
  // Owned here, not in the card, so pull-to-refresh can await it.
  const athletesState = useSessionAthletes(
    (params.meet || null) as MeetName | null,
    parsedSessionNumber,
    params.platform,
  );
  const { refreshAthletes } = athletesState;

  // This session's day and platform row in the current schedule, looked up
  // once for the weight class, date and start time below.
  const sessionMatch = useMemo(
    () => findSessionPlatform(currentSchedule, parsedSessionNumber, params.platform),
    [currentSchedule, parsedSessionNumber, params.platform],
  );

  const sessionWeightClass =
    sessionMatch?.platform?.weightClass || params.weightClass;
  const sessionDate = sessionMatch?.day.date || `Session ${params.sessionNumber}`;
  // The platform's own start time wins over the one passed in.
  const platformStartTime =
    sessionMatch?.platform?.platformStartTime || params.startTime;

  // Calculate weigh-in time based on platform start time
  const platformWeighInTime = useMemo(() => {
    return calculateWeighInTime(platformStartTime);
  }, [platformStartTime]);

  // Both refreshes are awaited, so the spinner covers the athletes too, and
  // a failed athletes refresh is said out loud: it used to run from an effect
  // nobody awaited, and its failure was never shown. Neither rejects.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [, athletesRefreshed] = await Promise.all([
        refreshSchedule(),
        refreshAthletes(),
      ]);
      if (!athletesRefreshed) {
        showToast({ type: "error", message: REFRESH_FAILED_MESSAGE });
      }
    } finally {
      setRefreshing(false);
    }
  }, [refreshAthletes, refreshSchedule]);

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }, screenInsets]}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: sessionDate,
          gestureEnabled: true,
          gestureDirection: "horizontal",
          animation: "slide_from_right",
          headerBackButtonDisplayMode: "minimal",
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerShadowVisible: false,
          headerTitleStyle: {
            color: colors.text,
          },
          headerTintColor: colors.text
        }}
      />

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: 16 }]}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.text}
          />
        }
      >
        <View style={[styles.content, { backgroundColor: colors.background }]}>
          <HeaderSection
            sessionNumber={params.sessionNumber}
            platform={params.platform}
            weightClass={params.weightClass}
            startTime={params.startTime}
            meet={params.meet}
            currentSchedule={currentSchedule}
            sessionId={generateSessionId(
              params.meet,
              params.sessionNumber,
              params.platform,
            )}
            sessionDate={sessionDate}
            sessionWeightClass={sessionWeightClass || params.weightClass}
            platformStartTime={platformStartTime}
            platformWeighInTime={platformWeighInTime}
            athleteName={params.athleteName}
          />
          <SessionAthletes
            sessionNumber={parsedSessionNumber}
            platform={params.platform}
            meetId={params.meet as MeetName}
            athletesState={athletesState}
          />
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
});
