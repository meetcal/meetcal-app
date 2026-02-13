import { IconSymbol } from "@/components/ui/IconSymbol";
import { useNavigation, useRouter } from "expo-router";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Animated,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  ViewToken,
} from "react-native";

import {
  checkOnboardingComplete,
  OnboardingView,
} from "@/components/OnboardingView";
import { PageIndicator } from "@/components/PageIndicator";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { VersionAnnouncement } from "@/components/VersionAnnouncement";
import { getPlatformColors } from "@/constants/Colors";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { useTheme } from "@/contexts/ThemeContext";
import { MeetName } from "@/data/types/meet";
import { getMeetData, initStore } from "@/lib/database/offline-store";
import {
  DaySchedule,
  Platform as PlatformType,
  Schedule,
  Session,
} from "@/types/schedule";
import { useAuth } from "@clerk/clerk-expo";

const PLATFORM_SORT_ORDER = [
  "Red",
  "White",
  "Blue",
  "Stars",
  "Stripes",
  "Rogue",
] as const;

function SessionView({
  session,
  timeZone,
}: {
  session: Session;
  timeZone: string;
}) {
  const router = useRouter();
  const platformColors = getPlatformColors();
  const { currentTheme } = useTheme();

  const colors = {
    background: currentTheme === "dark" ? "#000000" : "#F5F5F5",
    card: currentTheme === "dark" ? "#1C1C1E" : "#FFFFFF",
    border: currentTheme === "dark" ? "#38383A" : "#E1E1E1",
    text: currentTheme === "dark" ? "#FFFFFF" : "#000000",
    secondaryText: currentTheme === "dark" ? "#8E8E93" : "#6B6B6B",
    pressed: currentTheme === "dark" ? "#2C2C2E" : "#F5F5F5",
  };

  const sortedPlatforms = useMemo(
    () =>
      [...session.platforms].sort((a, b) => {
        const idxA = PLATFORM_SORT_ORDER.indexOf(
          a.platform as (typeof PLATFORM_SORT_ORDER)[number],
        );
        const idxB = PLATFORM_SORT_ORDER.indexOf(
          b.platform as (typeof PLATFORM_SORT_ORDER)[number],
        );
        return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
      }),
    [session.platforms],
  );

  const handlePlatformPress = (platform: PlatformType) => {
    router.push({
      pathname: "/shared-screens/schedule-details",
      params: {
        id: `${session.id}-${platform.platform}`,
        sessionNumber: session.number,
        platform: platform.platform,
        weightClass: platform.weightClass,
        startTime: session.startTime,
        weighInTime: session.weighInTime,
      },
    });
  };

  if (sortedPlatforms.length === 0) return null;

  return (
    <View style={[styles.sessionContainer, { backgroundColor: colors.card }]}>
      <ThemedText style={[styles.sessionTitle, { color: colors.text }]}>
        Session {session.number}
      </ThemedText>

      <View
        style={[styles.platformsContainer, { backgroundColor: colors.card }]}
      >
        {sortedPlatforms.map((platform, index) => (
          <Pressable
            key={platform.platform}
            style={({ pressed }) => [
              styles.platformCard,
              { backgroundColor: colors.card },
              index < sortedPlatforms.length - 1 && [
                styles.platformCardBorder,
                { borderBottomColor: colors.border },
              ],
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={() => handlePlatformPress(platform)}
          >
            <View style={styles.platformContent}>
              <View
                style={[
                  styles.platformIndicator,
                  { backgroundColor: platformColors[platform.platform] },
                ]}
              >
                <ThemedText style={styles.platformText}>
                  {platform.platform}
                </ThemedText>
              </View>
              <View style={styles.platformInfo}>
                <ThemedText
                  style={[
                    styles.weightClassText,
                    { color: colors.secondaryText },
                  ]}
                >
                  {platform.weightClass}
                </ThemedText>
                <ThemedText
                  style={[
                    styles.platformTimeText,
                    { color: colors.secondaryText },
                  ]}
                >
                  Start: {platform.platformStartTime || session.startTime}{" "}
                  {timeZone}
                </ThemedText>
              </View>
            </View>
            <IconSymbol
              name="chevron.right"
              size={20}
              color={colors.secondaryText}
            />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function DayView({
  day,
  timeZone,
  onRefreshComplete,
  refreshing,
}: {
  day: DaySchedule;
  timeZone: string;
  onRefreshComplete?: () => Promise<void>;
  refreshing: boolean;
}) {
  const { currentTheme } = useTheme();

  const colors = {
    text: currentTheme === "dark" ? "#FFFFFF" : "#000000",
  };

  const onRefresh = useCallback(async () => {
    try {
      await onRefreshComplete?.();
    } catch (error) {
      console.error("Refresh failed:", error);
    }
  }, [onRefreshComplete]);

  return (
    <FlatList
      data={day.sessions}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <SessionView session={item} timeZone={timeZone} />
      )}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.text}
        />
      }
      ListEmptyComponent={() => (
        <View style={styles.emptyContainer}>
          <ThemedText style={styles.emptyText}>No sessions found</ThemedText>
        </View>
      )}
    />
  );
}

type Colors = {
  background: string;
  card: string;
  border: string;
  text: string;
  secondaryText: string;
  pressed: string;
};

export default function ScheduleScreen() {
  const { width } = useWindowDimensions();
  const navigation = useNavigation();
  const {
    selectedMeet,
    meetDetails,
    isLoading: isMeetLoading,
    setSelectedMeet,
    availableMeets,
    refreshAvailableMeets,
  } = useSelectedMeet();
  const [schedule, setSchedule] = useState<Schedule>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isChangingMeet, setIsChangingMeet] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [isRefreshingMeets, setIsRefreshingMeets] = useState(false);
  const { currentTheme } = useTheme();
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const headerColors = {
    text: currentTheme === "dark" ? "#FFFFFF" : "#000000",
  };
  const colors: Colors = {
    background: currentTheme === "dark" ? "#000000" : "#F5F5F5",
    card: currentTheme === "dark" ? "#1C1C1E" : "#FFFFFF",
    border: currentTheme === "dark" ? "#38383A" : "#E1E1E1",
    text: currentTheme === "dark" ? "#FFFFFF" : "#000000",
    secondaryText: currentTheme === "dark" ? "#8E8E93" : "#6B6B6B",
    pressed: currentTheme === "dark" ? "#2C2C2E" : "#F5F5F5",
  };
  const [currentPage, setCurrentPage] = useState(0);
  const [initialScrollIndex, setInitialScrollIndex] = useState(0);
  const skeletonPulse = useRef(new Animated.Value(0.4)).current;
  const previousHeaderTitleRef = useRef<string>("");
  const lastAppliedInitialIndexRef = useRef<string>("");

  const upcomingMeets = useMemo(() => {
    const getDateInTimeZone = (timeZone: string) => {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "numeric",
        day: "numeric",
      }).formatToParts(new Date());
      const year = Number(
        parts.find((part) => part.type === "year")?.value ?? "0",
      );
      const month = Number(
        parts.find((part) => part.type === "month")?.value ?? "1",
      );
      const day = Number(
        parts.find((part) => part.type === "day")?.value ?? "1",
      );
      return new Date(year, month - 1, day);
    };

    const startOfToday = getDateInTimeZone("America/Los_Angeles");
    const threeMonthsBefore = new Date(startOfToday);
    const threeMonthsAfter = new Date(startOfToday);
    threeMonthsBefore.setMonth(threeMonthsBefore.getMonth() - 3);
    threeMonthsAfter.setMonth(threeMonthsAfter.getMonth() + 3);

    return availableMeets.filter((meet) => {
      const start = new Date(meet.dates?.start ?? "");
      const end = new Date(meet.dates?.end ?? meet.dates?.start ?? "");
      if (Number.isNaN(start.getTime())) return false;
      const endDate = Number.isNaN(end.getTime()) ? start : end;
      return endDate >= threeMonthsBefore && start <= threeMonthsAfter;
    });
  }, [availableMeets]);

  useLayoutEffect(() => {
    const offlineDataIcon =
      Platform.OS === "ios" ? "square.and.arrow.down" : "download";
    navigation.setOptions({
      ...(Platform.OS === "ios" && {
        headerLeft: () => (
          <Pressable
            style={styles.headerIconButton}
            onPress={() => router.push("/(tabs)/(index)/offline-data")}
            accessibilityRole="button"
            accessibilityLabel="Offline data"
          >
            <IconSymbol
              name={offlineDataIcon}
              size={24}
              color={headerColors.text}
            />
          </Pressable>
        ),
      }),
      headerRight: () => (
        <View style={styles.headerActions}>
          {Platform.OS === "android" && (
            <Pressable
              style={styles.headerIconButton}
              onPress={() => router.push("/(tabs)/(index)/offline-data")}
              accessibilityRole="button"
              accessibilityLabel="Offline data"
            >
              <IconSymbol
                name={offlineDataIcon}
                size={24}
                color={headerColors.text}
              />
            </Pressable>
          )}
          <Pressable
            style={[styles.headerIconButton, { paddingTop: 8 }]}
            onPress={() => {
              if (isSignedIn) {
                router.push("/(tabs)/(index)/profile");
              } else {
                router.push({
                  pathname: "/(auth)/sign-in",
                  params: { from: "info" },
                });
              }
            }}
            accessibilityRole="button"
            accessibilityLabel={
              isSignedIn ? "My profile and settings" : "Sign in"
            }
          >
            <IconSymbol
              name={
                Platform.OS === "ios"
                  ? "person.circle.fill"
                  : "person-circle-sharp"
              }
              size={24}
              color={headerColors.text}
            />
          </Pressable>
        </View>
      ),
    });
  }, [headerColors.text, isSignedIn, navigation, router]);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(skeletonPulse, {
          toValue: 0.9,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(skeletonPulse, {
          toValue: 0.4,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [skeletonPulse]);

  useEffect(() => {
    initStore();
  }, []);

  // Check onboarding status on mount
  useEffect(() => {
    let aborted = false;

    const checkOnboarding = async () => {
      try {
        const completed = await checkOnboardingComplete();
        if (!aborted && !completed) {
          setShowOnboarding(true);
        }
      } catch (error) {
        if (!aborted) {
          console.error("Error checking onboarding status:", error);
        }
      }
    };

    checkOnboarding();

    return () => {
      aborted = true;
    };
  }, []);

  const SkeletonBlock = useCallback(
    ({ style }: { style: any }) => {
      const backgroundColor = currentTheme === "dark" ? "#2C2C2E" : "#E6E6EA";
      return (
        <Animated.View
          style={[
            styles.skeletonBlock,
            { backgroundColor, opacity: skeletonPulse },
            style,
          ]}
        />
      );
    },
    [currentTheme, skeletonPulse],
  );

  const renderLoadingSkeleton = useCallback(
    (label: string) => (
      <ThemedView
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <View
          style={[
            styles.filterContainer,
            {
              backgroundColor: colors.background,
              borderBottomColor:
                currentTheme === "dark" ? "#2C2C2E" : "#C6C6C8",
              borderBottomWidth: 1,
            },
          ]}
        >
          <View style={styles.filterRow}>
            <View
              style={[
                styles.filterButton,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={styles.filterTextContainer}>
                <SkeletonBlock style={styles.skeletonLineShort} />
                <SkeletonBlock style={styles.skeletonLine} />
              </View>
              <SkeletonBlock style={styles.skeletonIcon} />
            </View>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.skeletonContent}>
          {[0, 1, 2].map((index) => (
            <View
              key={`skeleton-${index}`}
              style={[
                styles.sessionContainer,
                { backgroundColor: colors.card },
              ]}
            >
              <View style={styles.skeletonSection}>
                <SkeletonBlock style={styles.skeletonTitle} />
                <SkeletonBlock style={styles.skeletonSubtitle} />
              </View>
              <View style={styles.skeletonTimeRow}>
                <SkeletonBlock style={styles.skeletonChip} />
                <SkeletonBlock style={styles.skeletonChip} />
              </View>
              <View
                style={[
                  styles.platformsContainer,
                  { backgroundColor: colors.card },
                ]}
              >
                {[0, 1, 2].map((row) => (
                  <View
                    key={`platform-${index}-${row}`}
                    style={styles.platformCard}
                  >
                    <View style={styles.platformContent}>
                      <SkeletonBlock style={styles.skeletonBadge} />
                      <View style={styles.platformInfo}>
                        <SkeletonBlock style={styles.skeletonLine} />
                        <SkeletonBlock style={styles.skeletonLineShort} />
                      </View>
                    </View>
                    <SkeletonBlock style={styles.skeletonTiny} />
                  </View>
                ))}
              </View>
            </View>
          ))}
          <ThemedText
            style={[
              styles.loadingText,
              { color: colors.secondaryText, marginTop: 12 },
            ]}
          >
            {label}
          </ThemedText>
        </ScrollView>
      </ThemedView>
    ),
    [SkeletonBlock, colors, currentTheme],
  );

  // Function to calculate the initial page based on current UTC date
  const calculateInitialPage = useCallback((scheduleData: Schedule): number => {
    if (!scheduleData || scheduleData.length === 0) return 0;

    // Get current date in UTC and format as YYYY-MM-DD
    const currentUTCDate = new Date().toISOString().split("T")[0];

    // Find the index of the current date or the closest future date using fullDate
    const currentDateIndex = scheduleData.findIndex(
      (day) => day.fullDate >= currentUTCDate,
    );

    // If current date is before all schedule dates, return 0 (first day)
    // If current date is after all schedule dates, return the last day
    // Otherwise, return the found index
    if (currentDateIndex === -1) {
      return scheduleData.length - 1; // Current date is after all schedule dates
    }

    return currentDateIndex;
  }, []);

  // Load schedule from cache (context handles syncing)
  const loadData = useCallback(
    async (meet: MeetName, options?: { showLoading?: boolean }) => {
      const showLoading = options?.showLoading ?? true;
      if (showLoading) setIsLoading(true);
      let scheduleData: Schedule = [];

      try {
        // Get cached data - context's SyncManager handles fetching/syncing
        const cachedMeetData = await getMeetData(meet);
        if (cachedMeetData?.schedule) {
          scheduleData = cachedMeetData.schedule;
        } else {
          console.log(`ScheduleScreen: No schedule found in cache for ${meet}`);
        }
      } catch (cacheError) {
        console.error(
          `ScheduleScreen: Failed to load schedule from cache for ${meet}:`,
          cacheError,
        );
      }

      setSchedule(scheduleData);

      // Calculate and set the initial page based on current UTC date
      if (scheduleData && scheduleData.length > 0) {
        const initialPage = calculateInitialPage(scheduleData);
        setInitialScrollIndex(initialPage);
        setCurrentPage(initialPage);
      }

      if (showLoading) setIsLoading(false);
    },
    [calculateInitialPage],
  );

  // Load data when selectedMeet changes
  useEffect(() => {
    if (selectedMeet && typeof selectedMeet === "string") {
      // Ensure selectedMeet is treated as MeetName type
      loadData(selectedMeet as MeetName);
    } else {
      // Clear schedule if no meet is selected
      setSchedule([]);
      setIsLoading(false);
    }
  }, [selectedMeet, loadData]);

  // Scroll to initial position after data is loaded
  useEffect(() => {
    if (!isLoading && schedule.length > 0 && initialScrollIndex > 0) {
      const applyKey = `${selectedMeet ?? "none"}:${schedule.length}:${initialScrollIndex}`;
      if (lastAppliedInitialIndexRef.current === applyKey) return;
      lastAppliedInitialIndexRef.current = applyKey;
      // Use a small delay to ensure the FlatList is fully rendered
      const timer = setTimeout(() => {
        flatListRef.current?.scrollToIndex({
          index: initialScrollIndex,
          animated: false,
        });
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [isLoading, schedule.length, initialScrollIndex, selectedMeet]);

  // Revised refresh handler
  const handleRefresh = useCallback(async () => {
    if (selectedMeet && typeof selectedMeet === "string") {
      setIsRefreshing(true);
      try {
        await loadData(selectedMeet as MeetName, { showLoading: false });
      } finally {
        setIsRefreshing(false);
      }
    } else {
      console.log("Refresh skipped: No meet selected");
    }
  }, [selectedMeet, loadData]);

  // Handle refreshing available meets in modal
  const handleRefreshMeets = useCallback(async () => {
    setIsRefreshingMeets(true);
    try {
      await refreshAvailableMeets();
    } catch (error) {
      console.error("Error refreshing meets:", error);
    } finally {
      setIsRefreshingMeets(false);
    }
  }, [refreshAvailableMeets]);

  const timeZoneAbbreviation = useMemo(() => {
    const timeZoneId =
      meetDetails?.time.timeZoneIdentifier || "America/New_York";
    return (
      new Intl.DateTimeFormat("en-US", {
        timeZone: timeZoneId,
        timeZoneName: "short",
      })
        .formatToParts(new Date())
        .find((part) => part.type === "timeZoneName")?.value || "Local"
    );
  }, [meetDetails?.time.timeZoneIdentifier]);

  const formatDayTitle = useCallback((day: DaySchedule) => {
    const sourceDate = day.fullDate || day.date;
    if (!sourceDate) return day.date;

    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sourceDate);
    if (isoMatch) {
      const year = Number(isoMatch[1]);
      const month = Number(isoMatch[2]);
      const dayOfMonth = Number(isoMatch[3]);
      const utcDate = new Date(Date.UTC(year, month - 1, dayOfMonth));
      return new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(utcDate);
    }

    const parsed = new Date(sourceDate);
    if (Number.isNaN(parsed.getTime())) return day.date;

    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    }).format(parsed);
  }, []);

  const onViewableItemsChanged = useCallback(
    ({
      viewableItems,
    }: {
      viewableItems: ViewToken[];
      changed: ViewToken[];
    }) => {
      if (viewableItems.length > 0) {
        const currentItem = viewableItems[0].item as DaySchedule;
        const formattedTitle = formatDayTitle(currentItem);
        if (previousHeaderTitleRef.current === formattedTitle) return;
        previousHeaderTitleRef.current = formattedTitle;
        navigation.setOptions({
          title: formattedTitle,
        });
      }
    },
    [formatDayTitle, navigation],
  );

  // Set title to start date when there's no schedule loaded
  useEffect(() => {
    if (!isLoading && schedule.length === 0 && meetDetails?.dates?.start) {
      const startDate = new Date(meetDetails.dates.start);
      if (!Number.isNaN(startDate.getTime())) {
        const formattedDate = new Intl.DateTimeFormat("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
        }).format(startDate);
        navigation.setOptions({
          title: formattedDate,
        });
        previousHeaderTitleRef.current = formattedDate;
      }
    }
  }, [isLoading, schedule.length, meetDetails, navigation]);

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  const handlePageChange = useCallback(
    (index: number) => {
      if (index === currentPage) return;
      setCurrentPage(index);
      flatListRef.current?.scrollToIndex({ index, animated: true });
    },
    [currentPage],
  );

  const flatListRef = useRef<FlatList>(null);

  const onMomentumScrollEnd = useCallback(
    (event: any) => {
      const newPage = Math.round(event.nativeEvent.contentOffset.x / width);
      if (newPage !== currentPage) {
        setCurrentPage(newPage);
      }
    },
    [currentPage, width],
  );

  // Update the renderDayView to use handleRefresh
  const renderDayView = useCallback(
    ({ item }: { item: DaySchedule }) => (
      <View style={[styles.pageContainer, { width }]}>
        <DayView
          day={item}
          timeZone={timeZoneAbbreviation}
          onRefreshComplete={handleRefresh}
          refreshing={isRefreshing}
        />
      </View>
    ),
    [width, timeZoneAbbreviation, handleRefresh, isRefreshing],
  );

  if (isMeetLoading) {
    return renderLoadingSkeleton("Loading meets...");
  }

  if (!selectedMeet || !meetDetails) {
    return (
      <ThemedView
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <View style={styles.loadingContainer}>
          <ThemedText style={[styles.loadingText, { color: colors.text }]}>
            Please select a meet to view the schedule
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (isLoading || isChangingMeet) {
    return renderLoadingSkeleton("Loading schedule...");
  }

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <OnboardingView
        visible={showOnboarding}
        onComplete={() => setShowOnboarding(false)}
      />

      <View
        style={[
          styles.filterContainer,
          {
            backgroundColor: colors.background,
            borderBottomColor: currentTheme === "dark" ? "#2C2C2E" : "#C6C6C8",
            borderBottomWidth: 1,
          },
        ]}
      >
        <View style={styles.filterRow}>
          <Pressable
            style={({ pressed }) => [
              styles.filterButton,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={() => setShowFilterModal(true)}
          >
            <View style={styles.filterTextContainer}>
              <ThemedText
                style={[styles.filterButtonText, { color: colors.text }]}
              >
                Selected Meet
              </ThemedText>
              <ThemedText
                style={[styles.meetValue, { color: colors.secondaryText }]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {selectedMeet}
              </ThemedText>
            </View>
            <IconSymbol
              name="chevron.down"
              size={12}
              color={colors.secondaryText}
            />
          </Pressable>
        </View>
      </View>

      <VersionAnnouncement />

      {!schedule || schedule.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyStateContainer}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.text}
            />
          }
        >
          <Image
            source={require("@/assets/images/MeetCal-no-bg.png")}
            style={styles.emptyStateImage}
            resizeMode="contain"
          />
          <ThemedText
            style={[styles.emptyStateText, { color: colors.secondaryText }]}
          >
            No data has been loaded yet for this meet. Check back soon!
          </ThemedText>
        </ScrollView>
      ) : (
        <View style={styles.contentContainer}>
          <FlatList
            ref={flatListRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            data={schedule}
            keyExtractor={(item, index) =>
              item.fullDate || `${item.date}-${index}`
            }
            renderItem={renderDayView}
            initialScrollIndex={initialScrollIndex}
            getItemLayout={(data, index) => ({
              length: width,
              offset: width * index,
              index,
            })}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            onMomentumScrollEnd={onMomentumScrollEnd}
          />

          {schedule.length > 0 && (
            <PageIndicator
              count={schedule.length}
              currentPage={currentPage}
              onPageChange={handlePageChange}
            />
          )}
        </View>
      )}

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
            <View
              style={[styles.modalHeader, { borderBottomColor: colors.border }]}
            >
              <ThemedText style={[styles.modalTitle, { color: colors.text }]}>
                Select Your Meet
              </ThemedText>
              <Pressable
                style={({ pressed }) => [
                  styles.closeButton,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => setShowFilterModal(false)}
              >
                <IconSymbol
                  name={Platform.OS === "ios" ? "xmark" : "close"}
                  size={20}
                  color={colors.secondaryText}
                />
              </Pressable>
            </View>

            <ScrollView
              style={styles.modalScrollView}
              contentContainerStyle={styles.modalScrollContent}
              alwaysBounceVertical
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshingMeets}
                  onRefresh={handleRefreshMeets}
                  tintColor={colors.text}
                />
              }
            >
              {upcomingMeets.map((meet) => (
                <Pressable
                  key={meet.name}
                  style={({ pressed }) => [
                    styles.modalOption,
                    { borderBottomColor: colors.border },
                    selectedMeet === meet.name && {
                      backgroundColor: colors.pressed,
                    },
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={async () => {
                    setShowFilterModal(false);
                    if (meet.name === selectedMeet) return;
                    setIsChangingMeet(true);
                    try {
                      await setSelectedMeet(meet.name);
                    } catch (error) {
                      console.error("Error saving selected meet:", error);
                      Alert.alert("Error", "Failed to update selected meet.");
                    } finally {
                      setIsChangingMeet(false);
                    }
                  }}
                >
                  <ThemedText
                    style={[
                      styles.modalOptionText,
                      { color: colors.text },
                      selectedMeet === meet.name && { color: "#007AFF" },
                    ]}
                  >
                    {meet.name}
                  </ThemedText>
                  {selectedMeet === meet.name && (
                    <IconSymbol name="checkmark" size={16} color="#007AFF" />
                  )}
                </Pressable>
              ))}

              {upcomingMeets.length === 0 && (
                <View style={styles.emptyContainer}>
                  <ThemedText style={styles.emptyText}>
                    No meets available in the next 6 months
                  </ThemedText>
                </View>
              )}
            </ScrollView>
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
  pageContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 120,
  },
  sessionContainer: {
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
    paddingBottom: 4,
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
  platformsContainer: {
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    overflow: "hidden",
    margin: 16,
    marginTop: 0,
  },
  platformCard: {
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  platformCardBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E1E1E1",
  },
  platformCardPressed: {
    backgroundColor: "#F5F5F5",
  },
  platformContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginRight: 12,
  },
  platformIndicator: {
    paddingHorizontal: 4,
    paddingVertical: 4,
    width: 64,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 6,
  },
  platformText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "600",
  },
  platformInfo: {
    flex: 1,
    marginLeft: 8,
  },
  platformTimeText: {
    fontSize: 13,
    marginTop: 2,
  },
  weightClassText: {
    fontSize: 15,
  },
  filterContainer: {
    padding: 16,
  },
  filterRow: {
    width: "100%",
  },
  filterButton: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    elevation: 1,
  },
  filterTextContainer: {
    flex: 1,
    marginRight: 8,
  },
  filterButtonText: {
    fontSize: 15,
    fontWeight: "600",
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
    marginHorizontal: 16,
    maxHeight: "70%",
  },
  modalHeader: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    position: "relative",
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  closeButton: {
    position: "absolute",
    right: 16,
    top: 16,
    padding: 4,
    zIndex: 1,
  },
  refreshButton: {
    position: "absolute",
    left: 16,
    top: 16,
    padding: 4,
    zIndex: 1,
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
    width: "90%",
  },
  meetValue: {
    fontSize: 15,
    marginTop: 2,
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
  emptyStateContainer: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingVertical: 24,
    gap: 16,
  },
  emptyStateText: {
    fontSize: 16,
    textAlign: "center",
    lineHeight: 22,
  },
  emptyStateImage: {
    width: 144,
    height: 144,
  },
  contentContainer: {
    flex: 1,
    position: "relative",
  },

  syncInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    fontSize: 16,
    textAlign: "center",
  },
  skeletonContent: {
    padding: 16,
    paddingBottom: 40,
  },
  skeletonBlock: {
    borderRadius: 6,
  },
  skeletonSection: {
    padding: 16,
    paddingBottom: 8,
  },
  skeletonTitle: {
    height: 18,
    width: "60%",
    marginBottom: 10,
  },
  skeletonSubtitle: {
    height: 14,
    width: "40%",
  },
  skeletonLine: {
    height: 12,
    width: "75%",
  },
  skeletonLineShort: {
    height: 12,
    width: "45%",
    marginTop: 6,
  },
  skeletonIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  skeletonChip: {
    height: 12,
    width: 80,
    borderRadius: 6,
  },
  skeletonBadge: {
    width: 52,
    height: 22,
    borderRadius: 6,
  },
  skeletonTiny: {
    width: 24,
    height: 12,
    borderRadius: 6,
  },
  skeletonTimeRow: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: "row",
    gap: 12,
  },
  modalScrollView: {
    flexGrow: 0,
  },
  modalScrollContent: {
    flexGrow: 1,
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
});
