import HeaderSection from "@/components/schedule-details/HeaderSection";
import SessionAthletes from "@/components/schedule-details/SessionAthletes";
import { ThemedView } from "@/components/ui/ThemedView";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { MeetName } from "@/data/types/meet";
import { useAppColors } from "@/hooks/useAppColors";
import { useScheduleData } from "@/hooks/useScheduleData";
import {
  DaySchedule,
  Platform as PlatformDetails,
} from "@/types/schedule";
import { Session } from "@/types/schedule-details";
import { generateSessionId } from "@/utils/session";
import { calculateWeighInTime } from "@/utils/time";
import { Stack, useLocalSearchParams } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";

export default function SessionDetailsScreen() {
  const colors = useAppColors();
  const { selectedMeet } = useSelectedMeet();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

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

  // Get the correct weight class from current schedule
  const sessionWeightClass = useMemo(() => {
    const sessionDay = currentSchedule.find((day: DaySchedule) =>
      day.sessions.some(
        (s: Session) => s.number === parsedSessionNumber,
      ),
    );

    const session = sessionDay?.sessions.find(
      (s: Session) => s.number === parsedSessionNumber,
    );

    const platformData = session?.platforms.find(
      (p: PlatformDetails) => p.platform === params.platform,
    );

    return platformData?.weightClass || params.weightClass;
  }, [
    currentSchedule,
    parsedSessionNumber,
    params.platform,
    params.weightClass,
  ]);

  const sessionDate = useMemo(() => {
    const sessionDay = currentSchedule.find((day: DaySchedule) =>
      day.sessions.some(
        (s: Session) => s.number === parsedSessionNumber,
      ),
    );
    return sessionDay?.date || `Session ${params.sessionNumber}`;
  }, [currentSchedule, parsedSessionNumber, params.sessionNumber]);

  // Get the platform-specific start time
  const platformStartTime = useMemo(() => {
    const sessionDay = currentSchedule.find((day: DaySchedule) =>
      day.sessions.some(
        (s: Session) => s.number === parsedSessionNumber,
      ),
    );

    const session = sessionDay?.sessions.find(
      (s: Session) => s.number === parsedSessionNumber,
    );

    const platformData = session?.platforms.find(
      (p: PlatformDetails) => p.platform === params.platform,
    );

    return platformData?.platformStartTime || params.startTime;
  }, [
    currentSchedule,
    parsedSessionNumber,
    params.platform,
    params.startTime,
  ]);

  // Calculate weigh-in time based on platform start time
  const platformWeighInTime = useMemo(() => {
    return calculateWeighInTime(platformStartTime);
  }, [platformStartTime]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshSchedule();
      setRefreshKey((prev) => prev + 1);
    } catch (error) {
      console.error("Refresh failed:", error);
    } finally {
      setRefreshing(false);
    }
  }, [refreshSchedule]);

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }]}
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
            refreshKey={refreshKey}
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
