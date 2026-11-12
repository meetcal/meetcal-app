import { IconSymbol } from "@/components/ui/IconSymbol";
import { useNavigation } from "expo-router";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { CenteredHeaderDate } from "@/components/schedule/CenteredHeaderDate";
import { DayView } from "@/components/schedule/DayView";
import { useMeetZone } from "@/hooks/useMeetZone";
import { meetTimeZoneLabel } from "@/utils/timezone";
import { MeetSelectionModal } from "@/components/schedule/MeetSelectionModal";
import { OnboardingView } from "@/components/schedule/OnboardingView";
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
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { usePaginatedSchedule } from "@/hooks/usePaginatedSchedule";
import { useScheduleData } from "@/hooks/useScheduleData";
import { useScheduleHeaderButtons } from "@/hooks/useScheduleHeaderButtons";
import { useInitialScheduleScroll, useMeetStartDateTitle } from "@/hooks/useScheduleOpeningView";
import { useStartupScreenReport } from "@/hooks/useStartupScreenReport";
import { useUpcomingMeets } from "@/hooks/useUpcomingMeets";
import { initStore } from "@/lib/database/offline-store";
import { loadFailureCopy } from "@/lib/load-failure";
import { noMeetState } from "@/lib/schedule-empty-state";
import { DaySchedule } from "@/types/schedule";
import { formatDayTitle } from "@/utils/dateTime";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Palette } from "@/constants/Palette";

const IPHONE_DUO_HORIZONTAL_INSET = 84;

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
  const colors = useAppColors();
  const [isOffline] = useIsOffline();
  const { onboardingStatus, completeOnboarding } = useOnboardingStatus();
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [isRefreshingMeets, setIsRefreshingMeets] = useState(false);
  const [isChangingMeet, setIsChangingMeet] = useState(false);

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
          ? () => <CenteredHeaderDate>{title}</CenteredHeaderDate>
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

  const meetZone = useMeetZone(meetDetails?.time);

  useScheduleHeaderButtons();

  useEffect(() => {
    void initStore();
  }, []);

  useInitialScheduleScroll({
    isLoading,
    scheduleLength: schedule.length,
    initialScrollIndex,
    selectedMeet,
    flatListRef,
  });

  useMeetStartDateTitle({
    isLoading,
    scheduleLength: schedule.length,
    meetDetails,
    setHeaderTitle,
  });

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

  const onboarding = (
    <OnboardingView
      visible={onboardingStatus === "showing"}
      onComplete={completeOnboarding}
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
});
