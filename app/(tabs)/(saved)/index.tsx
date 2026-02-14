import SessionCard from "@/components/saved/SessionCard";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { useSavedSessions } from "@/contexts/SavedSessionsContext";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { MeetName, isMeetName } from "@/data/types/meet";
import { useAppColors } from "@/hooks/useAppColors";
import { SavedSession } from "@/hooks/useSavedSessions";
import { fetchSchedule } from "@/lib/database/queries";
import { LegacySavedSession, SessionScheduleLookup } from "@/types/saved";
import { Schedule as ScheduleType } from "@/types/schedule";
import { useAuthGuard } from "@/utils/authGuard";
import {
  CalendarSession,
  createCalendarEvents,
  requestCalendarPermissions,
} from "@/utils/calendar";
import { getTimeZoneAbbreviation } from "@/utils/dateTime";
import { migrateSessionsToMeetSpecific } from "@/utils/migration";
import { getSavedSessionsKey, makeLookupKey } from "@/utils/session";
import { calculateWeighInTime } from "@/utils/time";
import { useUser } from "@clerk/clerk-expo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation } from "@react-navigation/native";
import { useRouter } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Update SavedSession type to include meet
declare module "@/hooks/useSavedSessions" {
  interface SavedSession {
    meet: MeetName;
    id: string; // Now we ensure ID is always present
  }
}

export default function SavedScreen() {
  const { user } = useUser();
  const { savedSessions, saveSession, loadSavedSessions, resetAllSessions } =
    useSavedSessions();
  const { selectedMeet, availableMeets, meetDetails } = useSelectedMeet();
  const allowedMeetNames = useMemo(
    () => new Set(availableMeets.map((m) => m.name)),
    [availableMeets],
  );
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [letterFilter, setLetterFilter] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [hasMigrated, setHasMigrated] = useState(false);
  const { isSubscribed } = useSubscription();
  const { requireAuth } = useAuthGuard();
  const colors = useAppColors();
  // Add state for schedules map and loading
  const [schedulesMap, setSchedulesMap] = useState<Map<MeetName, ScheduleType>>(
    new Map(),
  );
  const [isSchedulesLoading, setIsSchedulesLoading] = useState(false);
  const schedulesMapRef = React.useRef<Map<MeetName, ScheduleType>>(new Map());
  const loadSavedSessionsRef = React.useRef(loadSavedSessions);

  useEffect(() => {
    schedulesMapRef.current = schedulesMap;
  }, [schedulesMap]);

  useEffect(() => {
    loadSavedSessionsRef.current = loadSavedSessions;
  }, [loadSavedSessions]);

  const handleResetSessions = useCallback(() => {
    // Check authentication first
    const authResult = requireAuth({
      feature: "delete-sessions",
      message: "Sign in to manage your saved sessions.",
      returnPath: "/(tabs)/(saved)",
    });
    if (authResult === null || authResult === false) {
      return;
    }

    // At this point, user must be authenticated
    if (!user?.id) return;

    Alert.alert(
      "Reset Saved Sessions",
      "Are you sure you want to remove all saved sessions? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            try {
              if (typeof resetAllSessions === "function") {
                await resetAllSessions(selectedMeet ?? undefined);
              }
              const STORAGE_KEYS = [
                getSavedSessionsKey(user!.id),
                `savedSessions_${user!.id}`,
                `@savedSessions_${user!.id}`,
                `sessions_${user!.id}`,
              ];
              for (const key of STORAGE_KEYS) {
                const stored = await AsyncStorage.getItem(key);
                if (stored) {
                  let sessions: { meet?: string }[] = [];
                  try {
                    const parsed: unknown = JSON.parse(stored);
                    if (Array.isArray(parsed))
                      sessions = parsed as { meet?: string }[];
                  } catch (err) {
                    console.error("Failed to parse stored sessions:", err, {
                      key,
                      stored,
                    });
                  }
                  if (Array.isArray(sessions)) {
                    const filtered = sessions.filter(
                      (s) => s.meet !== selectedMeet,
                    );
                    await AsyncStorage.setItem(key, JSON.stringify(filtered));
                  }
                }
              }
              await AsyncStorage.setItem(
                `@sessions_reset_${user!.id}`,
                Date.now().toString(),
              );
              Alert.alert(
                "Success",
                "All saved sessions for this meet have been reset.",
              );
            } catch (error) {
              console.error("Error resetting sessions:", error);
              Alert.alert("Error", "Failed to reset saved sessions.");
            }
          },
        },
      ],
    );
  }, [requireAuth, user, resetAllSessions, selectedMeet]);

  const timeZoneAbbr = useMemo(() => {
    if (!meetDetails?.time.timeZoneIdentifier) return "";
    return getTimeZoneAbbreviation(meetDetails.time.timeZoneIdentifier);
  }, [meetDetails?.time.timeZoneIdentifier]);

  const sessionLookupByMeet = useMemo(() => {
    const lookupByMeet = new Map<
      MeetName,
      Map<string, SessionScheduleLookup>
    >();

    for (const [meet, schedule] of schedulesMap.entries()) {
      const meetLookup = new Map<string, SessionScheduleLookup>();

      for (const day of schedule) {
        for (const session of day.sessions) {
          for (const platformInfo of session.platforms) {
            const startTime =
              platformInfo.platformStartTime || session.startTime;
            meetLookup.set(
              makeLookupKey(session.number, platformInfo.platform),
              {
                displayDate: day.date,
                fullDate: day.fullDate,
                startTime,
                weighInTime: calculateWeighInTime(startTime),
                weightClass: platformInfo.weightClass,
              },
            );
          }
        }
      }

      lookupByMeet.set(meet, meetLookup);
    }

    return lookupByMeet;
  }, [schedulesMap]);

  // Update migrateSessions function to use user-specific storage
  const migrateSessions = useCallback(async () => {
    if (!user?.id || !selectedMeet) return;

    try {
      console.log("Starting session migration");
      const STORAGE_KEYS = [
        getSavedSessionsKey(user.id), // Changed from getSavedWarmupsKey
        `savedSessions_${user.id}`,
        `@savedSessions_${user.id}`,
        `sessions_${user.id}`,
      ];
      let needsMigration = false;

      for (const key of STORAGE_KEYS) {
        const storedData = await AsyncStorage.getItem(key);
        if (storedData) {
          try {
            const parsed = JSON.parse(storedData);
            if (Array.isArray(parsed) && parsed.length > 0) {
              needsMigration = parsed.some((session) => !session.meet);
              if (needsMigration) {
                const migratedSessions = await migrateSessionsToMeetSpecific(
                  parsed,
                  selectedMeet,
                );

                await AsyncStorage.setItem(
                  getSavedSessionsKey(user.id),
                  JSON.stringify(migratedSessions),
                );

                await Promise.all(migratedSessions.map((session) => saveSession(session)));
              }
            }
          } catch (e) {
            console.error(`Error migrating sessions in ${key}:`, e);
          }
        }
      }

      setHasMigrated(true);
    } catch (error) {
      console.error("Error during session migration:", error);
    }
  }, [selectedMeet, saveSession, user?.id]);

  // Filter saved sessions by meet and letter - strict meet filtering
  const filteredSessions = useMemo(() => {
    const meetSessions = savedSessions.filter(
      (session) => session.meet === selectedMeet,
    );

    if (!letterFilter) {
      return meetSessions.sort((a, b) => a.sessionNumber - b.sessionNumber);
    }
    return meetSessions
      .filter((session) => {
        // Add null check for weightClass
        if (!session.weightClass) return false;
        const lastChar = session.weightClass.slice(-1);
        return lastChar === letterFilter;
      })
      .sort((a, b) => a.sessionNumber - b.sessionNumber);
  }, [savedSessions, selectedMeet, letterFilter]);

  // Extract unique letters from saved sessions for the current meet
  const filterOptions = useMemo(() => {
    const letterSet = new Set<string>();
    const meetSessions = savedSessions.filter(
      (session) => session.meet === selectedMeet,
    );

    meetSessions.forEach((session) => {
      // Add null check for weightClass
      if (session.weightClass) {
        const lastChar = session.weightClass.slice(-1);
        if (/^[A-G]$/.test(lastChar)) {
          letterSet.add(lastChar);
        }
      }
    });
    return Array.from(letterSet).sort();
  }, [savedSessions, selectedMeet]);

  const handleSaveToCalendar = useCallback(async () => {
    // 1. Check authentication first
    const authResult = requireAuth({
      feature: "add-to-calendar",
      message: "Sign in to add sessions to your calendar.",
      returnPath: "/(tabs)/(saved)",
    });
    if (authResult === null || authResult === false) {
      return;
    }

    // 2. Then check subscription
    if (!isSubscribed) {
      router.push({
        pathname: "/shared-screens/paywall",
        params: {
          from: "/(tabs)/(saved)",
          feature: "add-to-calendar",
        },
      } as any);
      return;
    }

    if (filteredSessions.length === 0) {
      Alert.alert("No Sessions", "There are no sessions to add to calendar.");
      return;
    }
    // Check if schedules are still loading
    if (isSchedulesLoading) {
      Alert.alert(
        "Loading",
        "Schedule data is still loading, please wait a moment.",
      );
      return;
    }

    Alert.alert(
      "Add to Calendar",
      `Add ${filteredSessions.length} session${filteredSessions.length === 1 ? "" : "s"} to your calendar?`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Add",
          onPress: async () => {
            try {
              const hasPermission = await requestCalendarPermissions();
              if (!hasPermission) {
                Alert.alert(
                  "Permission Required",
                  "Calendar permission is required to add sessions.",
                );
                return;
              }

              // Filter out sessions without meet information or missing schedules
              const validSessions = filteredSessions.filter((session) => {
                if (
                  !session.meet ||
                  !isMeetName(session.meet, allowedMeetNames)
                )
                  return false;
                return sessionLookupByMeet.has(session.meet);
              }) as (SavedSession & { meet: MeetName })[];

              if (validSessions.length === 0) {
                Alert.alert(
                  "Error",
                  "No valid sessions found with complete schedule information.",
                );
                return;
              }

              const sessionsToAdd: CalendarSession[] = validSessions
                .map((session) => {
                  const lookup = sessionLookupByMeet
                    .get(session.meet)
                    ?.get(
                      makeLookupKey(session.sessionNumber, session.platform),
                    );
                  const startTime = lookup?.startTime || session.startTime;
                  const weighInTime =
                    lookup?.weighInTime ||
                    (startTime
                      ? calculateWeighInTime(startTime)
                      : session.weighInTime);

                  return {
                    date: lookup?.fullDate || "",
                    startTime: startTime,
                    weighInTime: weighInTime,
                    sessionNumber: session.sessionNumber.toString(),
                    platform: session.platform,
                    weightClass: lookup?.weightClass || session.weightClass,
                    meet: session.meet,
                  };
                })
                .filter((s) => s.date && s.startTime && s.weighInTime); // Ensure critical info is present

              if (sessionsToAdd.length !== validSessions.length) {
                console.warn(
                  "Some sessions were skipped due to missing schedule details (date/time).",
                );
                // Optionally inform the user
              }

              if (sessionsToAdd.length === 0) {
                Alert.alert(
                  "Error",
                  "Could not extract necessary details for calendar events.",
                );
                return;
              }

              await createCalendarEvents(sessionsToAdd);
              Alert.alert(
                "Success",
                "Sessions have been added to your calendar.",
              );
            } catch (error) {
              Alert.alert(
                "Error",
                error instanceof Error
                  ? error.message
                  : "Failed to add sessions to calendar.",
              );
              console.error(error);
            }
          },
        },
      ],
    );
  }, [requireAuth, isSubscribed, router, filteredSessions, isSchedulesLoading, sessionLookupByMeet, allowedMeetNames]);

  // Update forceLoadSessions to use loadSavedSessions from the context
  const forceLoadSessions = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      console.log("Force reloading sessions from source...");
      // REMOVE: Old implementation reading from AsyncStorage and calling saveSession
      // ADD: Call loadSavedSessions from the hook
      await loadSavedSessions();
    } catch (error) {
      console.error("Error force reloading sessions:", error);
    } finally {
      setRefreshing(false);
    }
    // ADD: loadSavedSessions to dependency array
  }, [refreshing, loadSavedSessions]);

  const renderSession = useCallback(
    ({ item }: { item: LegacySavedSession }) => {
      return (
        <SessionCard
          item={item}
          selectedMeet={selectedMeet}
          onPress={() =>
            router.push({
              pathname: "/shared-screens/schedule-details",
              params: {
                ...item,
                startTime: item.startTime,
                weighInTime: item.weighInTime,
              },
            })
          }
          sessionLookupByMeet={sessionLookupByMeet}
          allowedMeetNames={allowedMeetNames}
          timeZoneIdentifier={meetDetails?.time.timeZoneIdentifier}
          timeZoneAbbr={timeZoneAbbr}
        />
      );
    },
    [
      selectedMeet,
      router,
      sessionLookupByMeet,
      allowedMeetNames,
      meetDetails?.time.timeZoneIdentifier,
      timeZoneAbbr,
    ],
  );

  useEffect(() => {
    if (!hasMigrated) {
      migrateSessions();
    }
  }, [hasMigrated, migrateSessions]);

  // Fetch schedules incrementally for saved sessions.
  useEffect(() => {
    const meetNames = Array.from(
      new Set(
        savedSessions
          .map((s) => s.meet)
          .filter((m): m is MeetName => isMeetName(m, allowedMeetNames)),
      ),
    );
    const requiredMeetSet = new Set(meetNames);

    let isCancelled = false;
    const run = async () => {
      setSchedulesMap((prev) => {
        const next = new Map<MeetName, ScheduleType>();
        let changed = prev.size !== requiredMeetSet.size;
        for (const [meet, schedule] of prev.entries()) {
          if (requiredMeetSet.has(meet)) {
            next.set(meet, schedule);
          } else {
            changed = true;
          }
        }
        if (changed) {
          schedulesMapRef.current = next;
        }
        return changed ? next : prev;
      });

      const missingMeets = meetNames.filter(
        (meet) => !schedulesMapRef.current.has(meet),
      );
      if (missingMeets.length === 0) {
        setIsSchedulesLoading(false);
        return;
      }

      setIsSchedulesLoading(true);
      await Promise.all(
        missingMeets.map(async (meetName) => {
          try {
            const schedule = await fetchSchedule(meetName);
            if (!isCancelled) {
              setSchedulesMap((prev) => {
                const next = new Map(prev);
                next.set(meetName, schedule);
                schedulesMapRef.current = next;
                return next;
              });
            }
          } catch (fetchError) {
            console.error(
              `Error fetching schedule for ${meetName}:`,
              fetchError,
            );
            if (!isCancelled) {
              setSchedulesMap((prev) => {
                const next = new Map(prev);
                next.set(meetName, []);
                schedulesMapRef.current = next;
                return next;
              });
            }
          }
        }),
      );
      if (!isCancelled) {
        setIsSchedulesLoading(false);
      }
    };

    run();
    return () => {
      isCancelled = true;
    };
  }, [savedSessions, allowedMeetNames]);

  useEffect(() => {
    if (!selectedMeet || filterOptions.length === 0 || !letterFilter) return;
    if (!filterOptions.includes(letterFilter)) {
      setLetterFilter(filterOptions[0] || "");
    }
  }, [selectedMeet, filterOptions, letterFilter]);

  useLayoutEffect(() => {
    const calendarIconColor = isSchedulesLoading
      ? colors.border
      : isSubscribed
        ? colors.text
        : colors.secondaryText;

    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable
            style={styles.headerIconButton}
            onPress={handleSaveToCalendar}
            disabled={isSchedulesLoading}
            accessibilityRole="button"
            accessibilityLabel="Add to calendar"
          >
            <IconSymbol name="calendar" size={24} color={calendarIconColor} />
          </Pressable>
          <Pressable
            style={styles.headerIconButton}
            onPress={handleResetSessions}
            accessibilityRole="button"
            accessibilityLabel="Delete all saved sessions"
          >
            <IconSymbol name="trash" size={24} color={colors.danger} />
          </Pressable>
        </View>
      ),
    });
  }, [
    colors.border,
    colors.danger,
    colors.secondaryText,
    colors.text,
    handleResetSessions,
    handleSaveToCalendar,
    isSchedulesLoading,
    isSubscribed,
    navigation,
  ]);

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <FlatList
        data={filteredSessions}
        keyExtractor={(item) => item.id}
        renderItem={renderSession}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 100 },
        ]}
        ListEmptyComponent={() => (
          <View style={styles.emptyContainer}>
            <ThemedText style={[styles.emptyText, { color: colors.secondaryText }]}>No saved sessions</ThemedText>
          </View>
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={forceLoadSessions}
            colors={[colors.link]}
            tintColor={colors.text}
          />
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerIconButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  list: {
    padding: 16,
  },
  emptyContainer: {
    padding: 16,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 16,
    textAlign: "center",
  },
});
