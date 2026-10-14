import { IconSymbol } from "@/components/ui/IconSymbol";
import { useNavigation, usePathname, useRouter } from "expo-router";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";

import { DayView } from "@/components/schedule/DayView";
import { useMeetZone } from "@/hooks/useMeetZone";
import { meetTimeZoneLabel } from "@/utils/timezone";
import { MeetSelectionModal } from "@/components/schedule/MeetSelectionModal";
import {
  checkOnboardingComplete,
  OnboardingView,
} from "@/components/schedule/OnboardingView";
import { PageIndicator } from "@/components/schedule/PageIndicator";
import { ScheduleSkeleton } from "@/components/schedule/ScheduleSkeleton";
import { VersionAnnouncement } from "@/components/schedule/VersionAnnouncement";
import { NextSessionCard } from "@/components/saved/NextSessionCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { showToast } from "@/components/ui/Toast";
import { useSavedSessions } from "@/contexts/SavedSessionsContext";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { useAppColors } from "@/hooks/useAppColors";
import { useIsOffline } from "@/hooks/useIsOffline";
import { usePaginatedSchedule } from "@/hooks/usePaginatedSchedule";
import { useScheduleData } from "@/hooks/useScheduleData";
import { useStartupScreenReport } from "@/hooks/useStartupScreenReport";
import { useUpcomingMeets } from "@/hooks/useUpcomingMeets";
import { initStore } from "@/lib/database/offline-store";
import { isMaestroE2E } from "@/lib/e2e";
import { loadFailureCopy } from "@/lib/load-failure";
import { noMeetState } from "@/lib/schedule-empty-state";
import { DaySchedule } from "@/types/schedule";
import {
  formatDayTitle,
  formatIsoDateTitle,
} from "@/utils/dateTime";
import { useAuthGuard } from "@/utils/authGuard";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Palette } from "@/constants/Palette";

const IPHONE_DUO_HORIZONTAL_INSET = 84;

/**
 * iOS 27.1 leading-aligns the native nav title on iPhone Duo's reorganised bar,
 * and `headerTitleAlign` is ignored by the iOS native stack. Rendering the date
 * as a custom title view puts it back in the centre, as on every other iPhone.
 * The explicit width keeps it inside the safe area rather than under the band.
 */
function HeaderDate({ children }: { children: string }) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  return (
    <View
      style={[styles.headerDate, { width: width - insets.left - insets.right }]}
    >
      <ThemedText style={[styles.headerDateText, { color: colors.text }]}>
        {children}
      </ThemedText>
    </View>
  );
}

export default function ScheduleScreen() {
  const screenInsets = useScreenHorizontalInsets();
  const insets = useSafeAreaInsets();
  const shouldUseCustomHeader =
    Platform.OS === "ios" &&
    Math.max(insets.left, insets.right) >= IPHONE_DUO_HORIZONTAL_INSET;
  const navigation = useNavigation();
  const {
    selectedMeet,
    meetDetails,
    isLoading: isMeetLoading,
    isResolvingStoredMeet,
    setSelectedMeet,
    availableMeets,
    refreshAvailableMeets,
  } = useSelectedMeet();
  // The guard, not Clerk's `isLoaded`: offline, Clerk never loads, and the
  // profile button returned early, so even a signed-in user with a valid
  // cached sign-in could not reach reminders, widget settings or Clear Cache.
  const { isAuthenticated, authState, notifyAuthPending } = useAuthGuard();
  const router = useRouter();
  const pathname = usePathname();
  const colors = useAppColors();
  const [isOffline] = useIsOffline();
  // "What's New" waits for this to be "done", so a fresh install never gets
  // it stacked on top of onboarding.
  const [onboardingStatus, setOnboardingStatus] = useState<
    "checking" | "showing" | "done"
  >("checking");
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [isRefreshingMeets, setIsRefreshingMeets] = useState(false);
  const [isChangingMeet, setIsChangingMeet] = useState(false);
  const lastAppliedInitialIndexRef = useRef<string>("");

  // Use custom hooks
  const {
    schedule,
    isLoading,
    isRefreshing,
    loadError,
    initialScrollIndex,
    source: scheduleSource,
    refreshSchedule,
  } = useScheduleData(selectedMeet, meetDetails?.time.timeZoneIdentifier);
  const scheduleFailure = loadError ? loadFailureCopy("schedule", isOffline) : null;

  // Tells the startup timing (and the splash) what this launch's first screen was.
  const onScheduleLayout = useStartupScreenReport(
    {
      onboardingShowing: onboardingStatus === "showing",
      meetsLoading: isMeetLoading,
      resolvingStoredMeet: isResolvingStoredMeet,
      hasMeet: !!selectedMeet && !!meetDetails,
      scheduleLoading: isLoading,
      changingMeet: isChangingMeet,
      scheduleDays: schedule.length,
      loadFailed: scheduleFailure !== null,
    },
    scheduleSource,
  );

  const { upcomingMeets } = useUpcomingMeets({ availableMeets });
  const { savedSessions } = useSavedSessions();

  const handleTitleChange = useCallback(
    (title: string) => {
      navigation.setOptions({
        title,
        headerTitle: shouldUseCustomHeader
          ? () => <HeaderDate>{title}</HeaderDate>
          : undefined,
      });
    },
    [navigation, shouldUseCustomHeader],
  );

  const {
    currentPage,
    pageWidth,
    flatListRef,
    handlePageChange,
    onViewableItemsChanged,
    onMomentumScrollEnd,
    viewabilityConfig,
    setHeaderTitle,
  } = usePaginatedSchedule({
    schedule,
    onTitleChange: handleTitleChange,
    formatDayTitle,
  });

  // Each day's times are labelled with the zone at that day
  // (`meetTimeZoneLabel`): a meet that spans a DST change reads "EDT" on
  // Saturday and "EST" on Sunday. Formatting *today* instead labelled a
  // December New York meet opened in September "EDT". No label while the
  // meet's details load; the old "America/New_York" default mislabelled them.
  const meetZone = useMeetZone(meetDetails?.time);

  // Header configuration
  useLayoutEffect(() => {
    const openOfflineData = () => router.push("/schedule-toolbar/offline-data");
    const openProfile = () => {
      if (authState === null) {
        notifyAuthPending();
        return;
      }
      if (authState) {
        router.push("/schedule-toolbar/profile");
      } else {
        router.push({
          pathname: "/(auth)/sign-in",
          // A real route, not a label: sign-in hands this straight to
          // `router.replace`, and the profile screen is where the tap was
          // headed.
          params: { from: "/schedule-toolbar/profile", feature: "profile" },
        });
      }
    };

    // Native UIBarButtonItems on iOS. Custom React views stay pinned to the
    // horizontal bar, so only native items get relocated into iPhone Duo's
    // vertical bar alongside the tab rail the way system apps do.
    if (Platform.OS === "ios") {
      navigation.setOptions({
        unstable_headerLeftItems: () => [
          {
            type: "button",
            label: "Offline data",
            icon: { type: "sfSymbol", name: "square.and.arrow.down" },
            onPress: openOfflineData,
          },
        ],
        unstable_headerRightItems: () => [
          {
            type: "button",
            label: isAuthenticated ? "My profile and settings" : "Sign in",
            icon: { type: "sfSymbol", name: "person.circle.fill" },
            onPress: openProfile,
          },
        ],
      });
      return;
    }

    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable
            style={styles.headerIconButton}
            onPress={openOfflineData}
            accessibilityRole="button"
            accessibilityLabel="Offline data"
          >
            <IconSymbol name="square.and.arrow.down" size={24} color={colors.text} />
          </Pressable>
          <Pressable
            style={[styles.headerIconButton, { paddingTop: 8 }]}
            onPress={openProfile}
            accessibilityRole="button"
            accessibilityLabel={
              isAuthenticated ? "My profile and settings" : "Sign in"
            }
          >
            <IconSymbol
              name="person-circle-sharp"
              size={24}
              color={colors.text}
            />
          </Pressable>
        </View>
      ),
    });
  }, [
    authState,
    colors.text,
    isAuthenticated,
    navigation,
    notifyAuthPending,
    pathname,
    router,
  ]);

  useEffect(() => {
    initStore();
  }, []);

  // Check onboarding status on mount
  useEffect(() => {
    if (isMaestroE2E()) {
      setOnboardingStatus("done");
      return;
    }

    let aborted = false;

    const checkOnboarding = async () => {
      try {
        const completed = await checkOnboardingComplete();
        if (!aborted) setOnboardingStatus(completed ? "done" : "showing");
      } catch (error) {
        if (!aborted) {
          console.error("Error checking onboarding status:", error);
          setOnboardingStatus("done");
        }
      }
    };

    checkOnboarding();

    return () => {
      aborted = true;
    };
  }, []);

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
  }, [
    isLoading,
    schedule.length,
    initialScrollIndex,
    selectedMeet,
    flatListRef,
  ]);

  // Set title to start date when there's no schedule loaded
  useEffect(() => {
    if (!isLoading && schedule.length === 0 && meetDetails?.dates?.start) {
      // The meet start date is a calendar date in the meet's timezone. Format
      // it through the shared UTC-safe helper; `new Date("2026-06-20")` is UTC
      // midnight and renders as Jun 19 on any US device.
      // Through the day list's setter, so it knows the header no longer
      // shows its day: switching back to a meet with a schedule then sets
      // that meet's day again instead of keeping this date.
      const formattedDate = formatIsoDateTitle(meetDetails.dates.start);
      if (formattedDate) setHeaderTitle(formattedDate);
    }
  }, [
    isLoading,
    schedule.length,
    meetDetails,
    setHeaderTitle,
  ]);

  // Handle refreshing available meets in modal
  const handleRefreshMeets = useCallback(async () => {
    setIsRefreshingMeets(true);
    try {
      await refreshAvailableMeets();
    } catch (error) {
      console.error("Error refreshing meets:", error);
      showToast({
        type: "error",
        message: "Couldn't load meets. Check your connection and try again.",
      });
    } finally {
      setIsRefreshingMeets(false);
    }
  }, [refreshAvailableMeets]);

  // Handle meet selection
  const handleSelectMeet = useCallback(
    async (meetName: string) => {
      setShowFilterModal(false);
      if (meetName === selectedMeet) return;
      setIsChangingMeet(true);
      try {
        await setSelectedMeet(meetName);
      } catch (error) {
        console.error("Error saving selected meet:", error);
        showToast({ type: "error", message: "Failed to update selected meet." });
      } finally {
        setIsChangingMeet(false);
      }
    },
    [selectedMeet, setSelectedMeet],
  );

  // Render day view
  const renderDayView = useCallback(
    ({ item }: { item: DaySchedule }) => (
      <View style={[styles.pageContainer, { width: pageWidth }]}>
        <DayView
          day={item}
          timeZone={meetTimeZoneLabel(meetZone, item.fullDate)}
          meet={selectedMeet || ""}
          onRefreshComplete={refreshSchedule}
          refreshing={isRefreshing}
        />
      </View>
    ),
    [pageWidth, meetZone, refreshSchedule, isRefreshing, selectedMeet],
  );

  // The tour is a modal that keeps its page in local state. It sits first in
  // the same fragment on every branch below, skeletons included, so a meet
  // list or schedule arriving mid-tour (a reconnect) cannot unmount it and
  // send the user back to page 1.
  const onboarding = (
    <OnboardingView
      visible={onboardingStatus === "showing"}
      onComplete={() => setOnboardingStatus("done")}
    />
  );
  const withOnboarding = (content: ReactNode) => (
    <>
      {onboarding}
      {content}
    </>
  );

  if (isMeetLoading) {
    return withOnboarding(<ScheduleSkeleton label="Loading meets..." />);
  }

  const meetSelectionModal = (
    <MeetSelectionModal
      visible={showFilterModal}
      onClose={() => setShowFilterModal(false)}
      meets={upcomingMeets}
      selectedMeet={selectedMeet}
      onSelectMeet={handleSelectMeet}
      onRefresh={handleRefreshMeets}
      isRefreshing={isRefreshingMeets}
    />
  );

  if (!selectedMeet || !meetDetails) {
    const emptyState = noMeetState({
      isOffline,
      hasMeets: upcomingMeets.length > 0,
    });
    return withOnboarding(
      <ThemedView
        testID="schedule-no-meet"
        style={[styles.container, { backgroundColor: colors.background }, screenInsets]}
      >
        <ScrollView
          contentContainerStyle={styles.emptyStateContainer}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshingMeets}
              onRefresh={handleRefreshMeets}
              tintColor={colors.text}
            />
          }
        >
          <EmptyState
            image={require("@/assets/images/MeetCal-no-bg.png")}
            imageSize={144}
            title={emptyState.title}
            message={emptyState.message}
            actionLabel={emptyState.actionLabel}
            onActionPress={
              emptyState.action === "choose-meet"
                ? () => setShowFilterModal(true)
                : () => void handleRefreshMeets()
            }
          />
        </ScrollView>
        {meetSelectionModal}
      </ThemedView>
    );
  }

  if ((isLoading && schedule.length === 0) || isChangingMeet) {
    return withOnboarding(<ScheduleSkeleton label="Loading schedule..." />);
  }

  return withOnboarding(
    <ThemedView
      testID="schedule-screen"
      style={[styles.container, { backgroundColor: colors.background }, screenInsets]}
    >
      <View
        style={[
          styles.filterContainer,
          {
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
            borderBottomWidth: 1,
          },
        ]}
      >
        <View style={styles.filterRow}>
          <Pressable
            testID="schedule-meet-selector"
            accessibilityRole="button"
            accessibilityLabel="Open meet selector"
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

      <NextSessionCard
        selectedMeet={selectedMeet}
        meetDetails={meetDetails}
        savedSessions={savedSessions}
        style={styles.nextSession}
      />

      {onboardingStatus === "done" && <VersionAnnouncement />}

      {!schedule || schedule.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyStateContainer}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={refreshSchedule}
              tintColor={colors.text}
            />
          }
        >
          {scheduleFailure ? (
            <EmptyState
              image={require("@/assets/images/MeetCal-no-bg.png")}
              imageSize={144}
              title={scheduleFailure.title}
              message={scheduleFailure.message}
              actionLabel="Retry"
              onActionPress={() => {
                void refreshSchedule();
              }}
            />
          ) : (
            <EmptyState
              image={require("@/assets/images/MeetCal-no-bg.png")}
              imageSize={144}
              title="No schedule yet"
              message="No data has been loaded yet for this meet. Check back soon!"
            />
          )}
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
              length: pageWidth,
              offset: pageWidth * index,
              index,
            })}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            onMomentumScrollEnd={onMomentumScrollEnd}
            onLayout={onScheduleLayout}
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

      {meetSelectionModal}
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
    shadowColor: Palette.shadow,
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
  meetValue: {
    fontSize: 15,
    marginTop: 2,
  },
  emptyStateContainer: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  nextSession: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  contentContainer: {
    flex: 1,
    position: "relative",
  },
  headerDate: {
    alignItems: "center",
  },
  headerDateText: {
    fontSize: 17,
    fontWeight: "600",
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
