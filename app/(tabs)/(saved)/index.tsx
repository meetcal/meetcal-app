import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { getPlatformColors } from "@/constants/Colors";
import { useSavedSessions } from "@/contexts/SavedSessionsContext";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useTheme } from "@/contexts/ThemeContext";
import {
  convertToUTC,
  formatTimeWithZone,
  getMeetConfig,
  getMeetVenueLocation,
} from "@/data/meets/config";
import { MeetName } from "@/data/types/meet";
import { SavedSession } from "@/hooks/useSavedSessions";
import { fetchSchedule } from "@/lib/database/queries";
import { Schedule as ScheduleType } from "@/types/schedule";
import { useAuthGuard } from "@/utils/authGuard";
import { useUser } from "@clerk/clerk-expo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation } from "@react-navigation/native";
import * as Calendar from "expo-calendar";
import { useFocusEffect, useRouter } from "expo-router";
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
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Function to get user-specific storage key
const getSavedWarmupsKey = (userId: string) => `@saved_warmups_${userId}`;
const getSavedSessionsKey = (userId: string) => `@saved_sessions_${userId}`;

// Add function to generate unique session IDs
function generateSessionId(
  meet: MeetName,
  sessionNumber: number | string,
  platform: string,
): string {
  return `${meet}-${sessionNumber}-${platform}`.replace(/\s+/g, "-");
}

// Update SavedSession type to include meet
declare module "@/hooks/useSavedSessions" {
  interface SavedSession {
    meet: MeetName;
    id: string; // Now we ensure ID is always present
  }
}

// Add a type that extends SavedSession to include the legacy athleteName property
interface LegacySavedSession extends SavedSession {
  athleteName?: string;
}

function isMeetName(
  meet: string | null,
  allowedNames?: ReadonlySet<string>,
): meet is MeetName {
  if (meet === null || typeof meet !== "string") return false;
  if (allowedNames !== undefined && allowedNames.size > 0)
    return allowedNames.has(meet);
  return true;
}

async function requestCalendarPermissions() {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  return status === "granted";
}

async function createCalendarEvents(
  sessions: {
    date: string;
    startTime: string;
    weighInTime: string;
    sessionNumber: string;
    platform: string;
    weightClass: string;
    meet: MeetName;
  }[],
) {
  try {
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

    for (const session of sessions) {
      if (!session.meet) {
        console.warn("Skipping session with no meet:", session);
        continue;
      }

      // Get meet config first
      const meetConfig = await getMeetConfig(session.meet);

      // Convert times to UTC using the meet's time zone
      const startDate = convertToUTC(
        session.startTime,
        session.date,
        session.meet,
      );
      const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);

      // Construct the deep link URL
      const deepLinkUrl = `meetcal://schedule-details?meet=${encodeURIComponent(session.meet)}&sessionNumber=${encodeURIComponent(session.sessionNumber)}&platform=${encodeURIComponent(session.platform)}`;

      await Calendar.createEventAsync(calendarId, {
        title: `Session ${session.sessionNumber} - Platform ${session.platform}`,
        location: getMeetVenueLocation(session.meet),
        notes: `Weight Class: ${session.weightClass}\nWeigh-in Time: ${formatTimeWithZone(session.weighInTime, session.meet)}`,
        startDate: startDate,
        endDate: endDate,
        timeZone: meetConfig.time.timeZoneIdentifier,
        url: deepLinkUrl,
        alarms: [
          {
            relativeOffset: -60,
          },
        ],
      });
    }
  } catch (error) {
    console.error("Error creating calendar events:", error);

    if (error instanceof Error && error.message === "no_calendar") {
      throw new Error(
        "No suitable calendar found. Please make sure you have at least one calendar set up on your device.",
      );
    }

    const errorMessage = Platform.select({
      ios: "Could not add events to calendar. Please try again.",
      android:
        "Could not add events to calendar. Please make sure you have a calendar app installed and try again.",
      default: "Could not add events to calendar. Please try again.",
    });

    throw new Error(errorMessage);
  }
}

const TIME_12H_REGEX = /^(\d{1,2}):(\d{2})\s+(AM|PM)$/i;

function calculateWeighInTime(startTime: string): string {
  const match = startTime.trim().match(TIME_12H_REGEX);
  if (!match) {
    console.warn(
      'calculateWeighInTime: invalid startTime format, expected "HH:MM AM/PM"',
      { startTime },
    );
    return "6:00 AM";
  }
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (hours < 1 || hours > 12) {
    console.warn("calculateWeighInTime: hours out of range 1-12", {
      startTime,
      hours,
    });
    return "6:00 AM";
  }
  if (minutes < 0 || minutes > 59) {
    console.warn("calculateWeighInTime: minutes out of range 0-59", {
      startTime,
      minutes,
    });
    return "6:00 AM";
  }
  if (period !== "AM" && period !== "PM") {
    console.warn("calculateWeighInTime: period must be AM or PM", {
      startTime,
      period,
    });
    return "6:00 AM";
  }
  let hour24 = hours;
  if (period === "PM" && hours !== 12) hour24 += 12;
  if (period === "AM" && hours === 12) hour24 = 0;
  let weighInHour = hour24 - 2;
  if (weighInHour < 0) weighInHour += 24;
  let weighInPeriod: "AM" | "PM" = "AM";
  if (weighInHour >= 12) {
    weighInPeriod = "PM";
    if (weighInHour > 12) weighInHour -= 12;
  }
  if (weighInHour === 0) weighInHour = 12;
  return `${weighInHour}:${minutes.toString().padStart(2, "0")} ${weighInPeriod}`;
}

// Update migration helper to include proper IDs
function migrateSessionsToMeetSpecific(sessions: any[], currentMeet: MeetName) {
  return sessions.map((session) => ({
    ...session,
    // If the session has a meet, keep it, otherwise assign to current meet
    meet: session.meet || currentMeet,
    // Regenerate ID to ensure uniqueness
    id: generateSessionId(
      session.meet || currentMeet,
      session.sessionNumber,
      session.platform,
    ),
  }));
}

type SessionScheduleLookup = {
  displayDate: string;
  fullDate: string;
  startTime: string;
  weighInTime: string;
  weightClass: string;
};

function makeLookupKey(
  sessionNumber: number | string,
  platform: string,
): string {
  return `${sessionNumber}-${platform}`;
}

// Create a separate SessionCard component
const SessionCard = React.memo(
  ({
    item,
    selectedMeet,
    onPress,
    onOpenWarmup,
    warmupByMeetAndName,
    sessionLookupByMeet,
    allowedMeetNames,
    timeZoneIdentifier,
    timeZoneAbbr,
  }: {
    item: LegacySavedSession;
    selectedMeet: MeetName | null;
    onPress: () => void;
    onOpenWarmup: (warmupId: string) => void;
    warmupByMeetAndName: Map<string, string>;
    sessionLookupByMeet: Map<MeetName, Map<string, SessionScheduleLookup>>;
    allowedMeetNames: ReadonlySet<string>;
    timeZoneIdentifier?: string;
    timeZoneAbbr: string;
  }) => {
    const { currentTheme } = useTheme();

    // Ensure meet is defined before using it
    const meet = item.meet || selectedMeet;
    if (!meet || !isMeetName(meet, allowedMeetNames)) {
      console.warn(
        "[SessionCard] No valid meet information available for session:",
        item,
      );
      return null;
    }

    const sessionNumber = item.sessionNumber?.toString() || "";
    const platform = item.platform || "";
    const lookup = sessionLookupByMeet
      .get(meet)
      ?.get(makeLookupKey(sessionNumber, platform));
    const weightClass = lookup?.weightClass || item.weightClass || "";
    const startTime = lookup?.startTime || item.startTime || "";
    const weighInTime =
      lookup?.weighInTime ||
      (startTime ? calculateWeighInTime(startTime) : item.weighInTime || "");
    const displayDate =
      lookup?.displayDate ||
      (item.date
        ? new Date(`${item.date}T12:00:00`).toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
            timeZone: timeZoneIdentifier || "UTC",
          })
        : "Date TBD");

    const colors = {
      card: currentTheme === "dark" ? "#1C1C1E" : "#FFFFFF",
      text: currentTheme === "dark" ? "#FFFFFF" : "#000000",
      secondaryText: currentTheme === "dark" ? "#8E8E93" : "#6B6B6B",
      pressed: currentTheme === "dark" ? "#2C2C2E" : "#F5F5F5",
      link: "#007AFF",
      border: currentTheme === "dark" ? "#38383A" : "#E1E1E1",
    };

    // Format time with the correct timezone abbreviation
    const formatTime = (time: string) => {
      if (!time) return "TBD";
      if (!timeZoneAbbr) return time;
      return `${time} ${timeZoneAbbr}`;
    };

    return (
      <Pressable
        style={({ pressed }) => [
          styles.sessionContainer,
          { backgroundColor: colors.card },
          pressed && { backgroundColor: colors.pressed },
        ]}
        onPress={onPress}
      >
        <ThemedText style={[styles.sessionTitle, { color: colors.text }]}>
          {/* Use displayDate derived from schedule map */}
          Session 
{' '}
{sessionNumber}
{" "}
          {displayDate !== "Date TBD" ? `• ${displayDate}` : ""}
        </ThemedText>

        {meet && meet !== selectedMeet && (
          <ThemedText
            style={[styles.meetName, { color: colors.secondaryText }]}
          >
            {meet.replace(/-/g, " ")}
          </ThemedText>
        )}

        <View style={styles.timeContainer}>
          <View style={styles.timeRow}>
            <View style={styles.timeBlock}>
              <ThemedText
                style={[styles.timeLabel, { color: colors.secondaryText }]}
              >
                Weigh-in:
              </ThemedText>
              <ThemedText
                style={[styles.timeText, { color: colors.secondaryText }]}
              >
                {formatTime(weighInTime)}
              </ThemedText>
            </View>
            <View style={styles.timeSeparator} />
            <View style={styles.timeBlock}>
              <ThemedText
                style={[styles.timeLabel, { color: colors.secondaryText }]}
              >
                Start:
              </ThemedText>
              <ThemedText
                style={[styles.timeText, { color: colors.secondaryText }]}
              >
                {formatTime(startTime)}
              </ThemedText>
            </View>
          </View>
        </View>

        <View
          style={[styles.platformContainer, { backgroundColor: colors.card }]}
        >
          <View
            style={[
              styles.platformIndicator,
              {
                backgroundColor:
                  getPlatformColors()[
                    platform as keyof ReturnType<typeof getPlatformColors>
                  ],
              },
            ]}
          >
            <ThemedText style={styles.platformText}>{platform}</ThemedText>
          </View>
          <ThemedText
            style={[styles.weightClassText, { color: colors.secondaryText }]}
          >
            {weightClass}
          </ThemedText>
        </View>

        {/* Display athlete names if available (saved from start list) */}
        {item.athleteNames &&
          Array.isArray(item.athleteNames) &&
          item.athleteNames.length > 0 && (
            <View
              style={[
                styles.athleteContainer,
                { borderTopColor: colors.border },
              ]}
            >
              <ThemedText
                style={[styles.athleteLabel, { color: colors.secondaryText }]}
              >
                {item.athleteNames.length === 1 ? "Athlete:" : "Athletes:"}
              </ThemedText>
              <View style={styles.athleteNamesContainer}>
                {item.athleteNames.slice(0, 3).map((name, index) => {
                  const athleteWarmupId = warmupByMeetAndName.get(
                    `${meet}::${name}`,
                  );

                  return (
                    <View key={index} style={styles.athleteRow}>
                      <ThemedText
                        style={[styles.athleteName, { color: colors.text }]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {name}
                      </ThemedText>
                      {/* Render link if a warmup exists for THIS athlete */}
                      {athleteWarmupId && (
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation();
                            onOpenWarmup(athleteWarmupId);
                          }}
                          style={({ pressed }) => [
                            styles.warmupLink,
                            pressed && { opacity: 0.7 },
                          ]}
                        >
                          <ThemedText
                            style={[
                              styles.warmupLinkText,
                              { color: colors.link },
                            ]}
                          >
                            Warmups
                          </ThemedText>
                          <IconSymbol
                            name="chevron.right"
                            size={12}
                            color={colors.link}
                          />
                        </Pressable>
                      )}
                    </View>
                  );
                })}
                {item.athleteNames.length > 3 && (
                  <ThemedText
                    style={[
                      styles.athleteMoreText,
                      { color: colors.secondaryText },
                    ]}
                  >
                    +
{item.athleteNames.length - 3}
{' '}
more
</ThemedText>
                )}
              </View>
            </View>
          )}

        {/* For backward compatibility with old saved sessions */}
        {!item.athleteNames && item.athleteName && (
          <View
            style={[styles.athleteContainer, { borderTopColor: colors.border }]}
          >
            <ThemedText
              style={[styles.athleteLabel, { color: colors.secondaryText }]}
            >
              Athlete:
            </ThemedText>
            <View style={styles.athleteRow}>
              <ThemedText style={[styles.athleteName, { color: colors.text }]}>
                {item.athleteName}
              </ThemedText>
              {/* Also fix backward compatibility section */}
              {(() => {
                const athleteWarmupId = item.athleteName
                  ? warmupByMeetAndName.get(`${meet}::${item.athleteName}`)
                  : undefined;
                return athleteWarmupId ? (
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      onOpenWarmup(athleteWarmupId);
                    }}
                    style={({ pressed }) => [
                      styles.warmupLink,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <ThemedText
                      style={[styles.warmupLinkText, { color: colors.link }]}
                    >
                      Warmups
                    </ThemedText>
                    <IconSymbol
                      name="chevron.right"
                      size={12}
                      color={colors.link}
                    />
                  </Pressable>
                ) : null;
              })()}
            </View>
          </View>
        )}

        {/* Display notes if available */}
        {item.notes && item.notes.length > 0 && (
          <View
            style={[styles.notesContainer, { borderTopColor: colors.border }]}
          >
            <ThemedText
              style={[styles.notesLabel, { color: colors.secondaryText }]}
            >
              Notes:
            </ThemedText>
            {item.notes
              .split("\n\n")
              .filter((note) => note.trim().length > 0)
              .map((note, index, array) => (
                <View key={index} style={styles.noteBlock}>
                  <ThemedText
                    style={[styles.notesText, { color: colors.text }]}
                  >
                    {note.trim()}
                  </ThemedText>
                  {index < array.length - 1 && (
                    <View
                      style={[
                        styles.noteDivider,
                        { backgroundColor: colors.border },
                      ]}
                    />
                  )}
                </View>
              ))}
          </View>
        )}
      </Pressable>
    );
  },
);

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
  const [showFilterModal, setShowFilterModal] = useState(false);
  const { currentTheme } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [hasMigrated, setHasMigrated] = useState(false);
  const [savedWarmups, setSavedWarmups] = useState<
    {
      id: string;
      name: string;
      meet: string;
    }[]
  >([]);
  const { isSubscribed } = useSubscription();
  const { requireAuth } = useAuthGuard();

  // Add state for schedules map and loading
  const [schedulesMap, setSchedulesMap] = useState<Map<MeetName, ScheduleType>>(
    new Map(),
  );
  const [isSchedulesLoading, setIsSchedulesLoading] = useState(false);
  const schedulesMapRef = React.useRef<Map<MeetName, ScheduleType>>(new Map());
  const warmupsInFlightRef = React.useRef<Promise<void> | null>(null);
  const lastWarmupsSnapshotRef = React.useRef<string | null>(null);
  const loadSavedSessionsRef = React.useRef(loadSavedSessions);
  const loadSavedWarmupsRef = React.useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    schedulesMapRef.current = schedulesMap;
  }, [schedulesMap]);

  useEffect(() => {
    loadSavedSessionsRef.current = loadSavedSessions;
  }, [loadSavedSessions]);

  const handleResetSessions = () => {
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
              let success = false;
              if (typeof resetAllSessions === "function") {
                success = await resetAllSessions(selectedMeet ?? undefined);
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
  };

  const colors = {
    background: currentTheme === "dark" ? "#000000" : "#F5F5F5",
    card: currentTheme === "dark" ? "#1C1C1E" : "#FFFFFF",
    border: currentTheme === "dark" ? "#38383A" : "#E1E1E1",
    text: currentTheme === "dark" ? "#FFFFFF" : "#000000",
    secondaryText: currentTheme === "dark" ? "#8E8E93" : "#6B6B6B",
    pressed: currentTheme === "dark" ? "#2C2C2E" : "#F5F5F5",
    link: "#007AFF",
  };

  const timeZoneAbbr = useMemo(() => {
    if (!meetDetails?.time.timeZoneIdentifier) return "";
    return (
      new Intl.DateTimeFormat("en-US", {
        timeZone: meetDetails.time.timeZoneIdentifier,
        timeZoneName: "short",
      })
        .formatToParts(new Date())
        .find((part) => part.type === "timeZoneName")?.value || ""
    );
  }, [meetDetails?.time.timeZoneIdentifier]);

  const warmupByMeetAndName = useMemo(() => {
    const map = new Map<string, string>();
    for (const warmup of savedWarmups) {
      if (!warmup?.meet || !warmup?.name || !warmup?.id) continue;
      map.set(`${warmup.meet}::${warmup.name}`, warmup.id);
    }
    return map;
  }, [savedWarmups]);

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

                migratedSessions.forEach((session) => {
                  saveSession(session);
                });
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

  const handleFilterSelect = (letter: string) => {
    setLetterFilter(letter);
    setShowFilterModal(false);
  };

  const handleSaveToCalendar = async () => {
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

              const sessionsToAdd = validSessions
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
  };

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

  // Add logging to loadSavedWarmups
  const loadSavedWarmups = useCallback(async () => {
    if (warmupsInFlightRef.current) {
      await warmupsInFlightRef.current;
      return;
    }

    const loadPromise = (async () => {
      try {
        // Check if warmups were reset
        if (user?.id) {
          const resetTimestamp = await AsyncStorage.getItem(
            `@saved_warmups_reset_${user.id}`,
          );
          if (resetTimestamp) {
            // Clear the reset flag
            await AsyncStorage.removeItem(`@saved_warmups_reset_${user.id}`);
            lastWarmupsSnapshotRef.current = null;
            setSavedWarmups([]);
            return;
          }

          // Load warmups from user-specific storage
          const storedWarmups = await AsyncStorage.getItem(
            getSavedWarmupsKey(user.id),
          );
          if (storedWarmups) {
            if (lastWarmupsSnapshotRef.current !== storedWarmups) {
              const warmups = JSON.parse(storedWarmups);
              setSavedWarmups(warmups);
              lastWarmupsSnapshotRef.current = storedWarmups;
            }
            return;
          }

          // Fallback to legacy storage
          const legacyWarmups = await AsyncStorage.getItem("@saved_warmups");
          if (legacyWarmups) {
            if (lastWarmupsSnapshotRef.current !== legacyWarmups) {
              const warmups = JSON.parse(legacyWarmups);
              setSavedWarmups(warmups);
              lastWarmupsSnapshotRef.current = legacyWarmups;
            }
            // Migrate to user-specific storage
            await AsyncStorage.setItem(
              getSavedWarmupsKey(user.id),
              legacyWarmups,
            );
          } else {
            lastWarmupsSnapshotRef.current = null;
            setSavedWarmups([]);
          }
        } else {
          lastWarmupsSnapshotRef.current = null;
          setSavedWarmups([]);
        }
      } catch (error) {
        console.error("Error loading warmups:", error);
      }
    })();

    warmupsInFlightRef.current = loadPromise;
    try {
      await loadPromise;
    } finally {
      warmupsInFlightRef.current = null;
    }
  }, [user?.id]);

  useEffect(() => {
    loadSavedWarmupsRef.current = loadSavedWarmups;
  }, [loadSavedWarmups]);

  // Load saved warmups when screen focuses
  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      const syncOnFocus = async () => {
        try {
          await Promise.all([
            loadSavedSessionsRef.current(),
            loadSavedWarmupsRef.current(),
          ]);
        } catch (error) {
          if (isActive) {
            console.error("Failed to sync saved data on focus:", error);
          }
        }
      };
      syncOnFocus();
      return () => {
        isActive = false;
      };
    }, []),
  );

  const handleOpenWarmup = useCallback(
    (warmupId: string) => {
      router.push({
        pathname: "/warmup-details",
        params: { id: warmupId },
      });
    },
    [router],
  );

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
          onOpenWarmup={handleOpenWarmup}
          warmupByMeetAndName={warmupByMeetAndName}
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
      handleOpenWarmup,
      warmupByMeetAndName,
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
            <IconSymbol name="trash" size={24} color="#FF3B30" />
          </Pressable>
        </View>
      ),
    });
  }, [
    colors.border,
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
            <ThemedText style={styles.emptyText}>
              {letterFilter
                ? `No ${letterFilter} sessions found`
                : "No saved sessions"}
            </ThemedText>
          </View>
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={forceLoadSessions}
            colors={["#007AFF"]}
            tintColor={colors.text}
          />
        }
      />

      <Modal
        visible={showFilterModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFilterModal(false)}
      >
        <Pressable
          style={[
            styles.modalOverlay,
            {
              backgroundColor:
                currentTheme === "dark" ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.4)",
            },
          ]}
          onPress={() => setShowFilterModal(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Pressable
              style={({ pressed }) => [
                styles.modalOption,
                { borderBottomColor: colors.border },
                letterFilter === "" && { backgroundColor: colors.pressed },
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => handleFilterSelect("")}
            >
              <ThemedText
                style={[
                  styles.modalOptionText,
                  { color: colors.text },
                  letterFilter === "" && { color: "#007AFF" },
                ]}
              >
                All Sessions
              </ThemedText>
              {letterFilter === "" && (
                <IconSymbol name="checkmark" size={16} color="#007AFF" />
              )}
            </Pressable>
            {filterOptions.map((letter) => (
              <Pressable
                key={letter}
                style={({ pressed }) => [
                  styles.modalOption,
                  { borderBottomColor: colors.border },
                  letterFilter === letter && {
                    backgroundColor: colors.pressed,
                  },
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => handleFilterSelect(letter)}
              >
                <ThemedText
                  style={[
                    styles.modalOptionText,
                    { color: colors.text },
                    letterFilter === letter && { color: "#007AFF" },
                  ]}
                >
                  {letter}
{' '}
Session
</ThemedText>
                {letterFilter === letter && (
                  <IconSymbol name="checkmark" size={16} color="#007AFF" />
                )}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
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
  sessionContainer: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  sessionTitle: {
    fontSize: 17,
    fontWeight: "600",
    padding: 16,
    paddingBottom: 0,
  },
  timeContainer: {
    padding: 16,
    paddingTop: 8,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  timeBlock: {
    flexDirection: "row",
    alignItems: "center",
  },
  timeSeparator: {
    width: 24,
  },
  timeLabel: {
    fontSize: 14,
    color: "#666",
    marginRight: 4,
  },
  timeText: {
    fontSize: 15,
    color: "#666",
  },
  platformContainer: {
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    overflow: "hidden",
    margin: 16,
    marginTop: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  platformIndicator: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  platformText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "600",
  },
  weightClassText: {
    fontSize: 15,
    color: "#666",
  },
  emptyContainer: {
    padding: 16,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 16,
  },
  modalContent: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    overflow: "hidden",
  },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalOptionText: {
    fontSize: 17,
  },
  athleteContainer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E1E1E1",
  },
  athleteLabel: {
    fontSize: 14,
    marginBottom: 4,
  },
  athleteNamesContainer: {
    flexDirection: "column",
    gap: 4,
    width: "100%",
  },
  athleteName: {
    fontSize: 15,
    fontWeight: "600",
    flexShrink: 1,
  },
  athleteMoreText: {
    fontSize: 14,
    fontStyle: "italic",
  },
  meetName: {
    fontSize: 14,
    fontStyle: "italic",
    marginLeft: 16,
    marginTop: 4,
  },
  athleteRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
  warmupLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  warmupLinkText: {
    fontSize: 14,
    fontWeight: "500",
  },
  notesContainer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  notesLabel: {
    fontSize: 14,
    marginBottom: 12,
    color: "#8E8E93",
  },
  notesText: {
    fontSize: 15,
    lineHeight: 20,
  },
  noteBlock: {
    marginBottom: 12,
  },
  noteDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },
});
