import HeaderSection from "@/components/schedule-details/HeaderSection";
import SessionAthletes from "@/components/schedule-details/SessionAthletes";
import { ThemedView } from "@/components/ui/ThemedView";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { MeetName } from "@/data/types/meet";
import { useAppColors } from "@/hooks/useAppColors";
import { getMeetData } from "@/lib/database/offline-store";
import {
  DaySchedule,
  Platform as PlatformDetails,
  Schedule,
} from "@/types/schedule";
import { requestCalendarPermissions } from "@/utils/calendar";
import { generateSessionId } from "@/utils/session";
import { calculateWeighInTime } from "@/utils/time";
import { Stack, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";

// Update interface names
interface SessionPlatformDetails {
  platform: string;
  platformStartTime?: string;
  weightClass?: string;
}

interface Session {
  number: number;
  platforms: SessionPlatformDetails[];
}

export default function SessionDetailsScreen() {
  const [hasCalendarPermission, setHasCalendarPermission] = useState(false);
  const colors = useAppColors();
  const { selectedMeet } = useSelectedMeet();
  const [refreshing, setRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionData, setSessionData] = useState<Session | null>(null);
  const [currentSchedule, setCurrentSchedule] = useState<Schedule>([]);
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

  useEffect(() => {
    (async () => {
      const hasPermission = await requestCalendarPermissions();
      setHasCalendarPermission(hasPermission);
    })();
  }, []);

  // Load session data from cache
  const loadSessionData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Get cached data (context's SyncManager handles syncing)
      const meetData = await getMeetData(params.meet as MeetName);
      if (meetData.schedule) {
        setCurrentSchedule(meetData.schedule);

        // Find the session in the schedule
        const day = meetData.schedule.find((day: DaySchedule) =>
          day.sessions.some(
            (s: Session) => s.number === parseInt(params.sessionNumber),
          ),
        );

        const session = day?.sessions.find(
          (s: Session) => s.number === parseInt(params.sessionNumber),
        );

        if (session) {
          setSessionData(session);
        }
      }
    } catch (error) {
      console.error("Error loading session data:", error);
    } finally {
      setIsLoading(false);
    }
  }, [params.meet, params.sessionNumber]);

  // Initial load
  useEffect(() => {
    loadSessionData();
  }, [loadSessionData]);

  // Get the correct weight class from current schedule
  const sessionWeightClass = useMemo(() => {
    const sessionDay = currentSchedule.find((day: DaySchedule) =>
      day.sessions.some(
        (s: Session) => s.number === parseInt(params.sessionNumber),
      ),
    );

    const session = sessionDay?.sessions.find(
      (s: Session) => s.number === parseInt(params.sessionNumber),
    );

    const platformData = session?.platforms.find(
      (p: PlatformDetails) => p.platform === params.platform,
    );

    return platformData?.weightClass || params.weightClass;
  }, [
    currentSchedule,
    params.sessionNumber,
    params.platform,
    params.weightClass,
  ]);

  const sessionDate = useMemo(() => {
    const sessionDay = currentSchedule.find((day: DaySchedule) =>
      day.sessions.some(
        (s: Session) => s.number === parseInt(params.sessionNumber),
      ),
    );
    return sessionDay?.date || `Session ${params.sessionNumber}`;
  }, [currentSchedule, params.sessionNumber]);

  // Get the platform-specific start time
  const platformStartTime = useMemo(() => {
    const sessionDay = currentSchedule.find((day: DaySchedule) =>
      day.sessions.some(
        (s: Session) => s.number === parseInt(params.sessionNumber),
      ),
    );

    const session = sessionDay?.sessions.find(
      (s: Session) => s.number === parseInt(params.sessionNumber),
    );

    const platformData = session?.platforms.find(
      (p: PlatformDetails) => p.platform === params.platform,
    );

    return platformData?.platformStartTime || params.startTime;
  }, [
    currentSchedule,
    params.sessionNumber,
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
      await loadSessionData();
      // Trigger athlete data refresh
      setRefreshKey((prev) => prev + 1);
    } catch (error) {
      console.error("Refresh failed:", error);
    } finally {
      setRefreshing(false);
    }
  }, [loadSessionData]);

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: sessionDate,
          headerBackTitle: "Back",
          gestureEnabled: true,
          gestureDirection: "horizontal",
          animation: "slide_from_right",
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerShadowVisible: false,
        }}
      />

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: 16 }]}
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
            sessionNumber={parseInt(params.sessionNumber)}
            platform={params.platform}
            sessionWeightClass={sessionWeightClass || params.weightClass}
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
