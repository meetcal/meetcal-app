import HeaderSection from "@/components/schedule-details/HeaderSection";
import SessionAthletes from "@/components/schedule-details/SessionAthletes";
import { ThemedView } from "@/components/ThemedView";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { MeetName } from "@/data/types/meet";
import { useAppColors } from "@/hooks/useAppColors";
import { getMeetData } from "@/lib/database/offline-store";
import {
  DaySchedule,
  Platform as PlatformDetails,
  Schedule,
} from "@/types/schedule";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Calendar from "expo-calendar";
import { Stack, useLocalSearchParams } from "expo-router";
import * as StoreReview from "expo-store-review";
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

// Add this helper function (or import it if you want to move it to a utilities file)
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

// Function to generate unique session IDs
function generateSessionId(
  meet: MeetName,
  sessionNumber: number | string,
  platform: string,
): string {
  return `${meet}-${sessionNumber}-${platform}`.replace(/\s+/g, "-");
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
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      setHasCalendarPermission(status === "granted");
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
