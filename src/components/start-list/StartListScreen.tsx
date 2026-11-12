import type { AthleteRequest } from "@/lib/api/results-api";
import { athleteResultsHref } from "@/lib/athlete-results-route";
import { CalendarDestinationPickerModal } from "@/components/calendar/CalendarDestinationPickerModal";
import ImagePreviewModal from "@/components/share/ImagePreviewModal";
import ActionModal from "@/components/start-list/ActionModal";
import { AthleteItem } from "@/components/start-list/AthleteItem";
import { ShareScheduleCaptureViews } from "@/components/start-list/ShareScheduleCaptureViews";
import { StartListEmptyState } from "@/components/start-list/StartListEmptyState";
import { StartListSearchBar } from "@/components/start-list/StartListSearchBar";
import { StartListSkeleton } from "@/components/start-list/StartListSkeleton";
import { buildStartListPillConfigs } from "@/components/start-list/startListPills";
import { ClubFilterModal, FilterPillBar } from "@/components/ui/filters";
import { ThemedView } from "@/components/ui/ThemedView";
import { showToast } from "@/components/ui/Toast";
import { ExpandedIdProvider } from "@/contexts/ExpandedIdContext";
import { useSavedSessions } from "@/contexts/SavedSessionsContext";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useTheme } from "@/contexts/ThemeContext";
import type { LiftResult } from "@/data/types/athletes";
import { isMeetName } from "@/data/types/meet";
import { useAppColors } from "@/hooks/useAppColors";
import { useCalendarSessionsExport } from "@/hooks/useCalendarSessionsExport";
import { useDownloadOptionsHeaderButton } from "@/hooks/useDownloadOptionsHeaderButton";
import { useFilterApplyReviewPrompt } from "@/hooks/useFilterApplyReviewPrompt";
import { useMeetZone } from "@/hooks/useMeetZone";
import { useRequirePremium } from "@/hooks/useRequirePremium";
import { useScheduleShareImages } from "@/hooks/useScheduleShareImages";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";
import { useStarredClubs } from "@/hooks/useStarredClubs";
import { useStartListData } from "@/hooks/useStartListData";
import { usePreloadYearBests, useYearBestsForSort } from "@/hooks/useStartListBests";
import { useStartListFilters } from "@/hooks/useStartListFilters";
import { groupCalendarSessions } from "@/lib/calendar-export";
import { successNotification } from "@/lib/haptics";
import { loadFailureCopy } from "@/lib/load-failure";
import { describeSaveSessionsFailure } from "@/lib/saved-sessions-actions";
import {
  buildScheduleCsv,
  buildSessionExportRows,
  describeIncompleteShare,
  scheduleCsvFileName,
  shareScheduleCsv,
} from "@/lib/start-list-export";
import {
  buildAgeGroupOptions,
  buildSessionDetailsLookup,
  buildWeightClassOptions,
  buildWsoOptions,
  compareStartListAthletes,
  effectiveStartListSort,
  filterStartListAthletes,
  getShareGroup,
  hasActiveStartListFilters,
  isBestLiftSort,
  isPremiumStartListPill,
  normalizeStartListAthletes,
  STARRED_CLUBS_FILTER,
} from "@/lib/start-list-utils";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { Alert, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const START_LIST_PATH = "/(tabs)/(start-list)";

const SELECT_SHARE_GROUP_MESSAGE =
  "Select a specific club or WSO from the filters to create a shareable schedule.";
const NO_ATHLETES_MESSAGE = "No athletes were found for the current filters.";

export default function StartListScreen() {
  const screenInsets = useScreenHorizontalInsets();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { currentTheme } = useTheme();
  const { selectedMeet, meetDetails } = useSelectedMeet();
  const { isSubscribed } = useSubscription();
  const {
    requirePremium: requirePremiumAction,
    requireCalendarExport,
    requireAuth,
  } = useRequirePremium();
  const { saveAllFromAthletes } = useSavedSessions();

  const { athletes, schedule, loading, refreshing, refresh, loadFailure } =
    useStartListData(selectedMeet);
  const {
    filters: storedFilters,
    selectPill,
    setClub,
    setSearch,
    resetFilters,
  } = useStartListFilters(selectedMeet);
  const { starredClubs, toggleStarredClub } = useStarredClubs();
  const trackFilterApply = useFilterApplyReviewPrompt();
  const calendarExport = useCalendarSessionsExport();

  const [showClubModal, setShowClubModal] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const shareImages = useScheduleShareImages();
  const listRef = useRef<FlashListRef<LiftResult>>(null);

  const filters = useMemo(
    () => ({
      ...storedFilters,
      sort: effectiveStartListSort(storedFilters.sort, isSubscribed),
    }),
    [storedFilters, isSubscribed],
  );
  const hasActiveFilters = hasActiveStartListFilters(filters);
  const isFiltering = hasActiveFilters || filters.search.length > 0;
  const shareGroup = getShareGroup(filters);

  const selectedMeetName =
    selectedMeet && isMeetName(selectedMeet) ? selectedMeet : null;
  const meetZone = useMeetZone(meetDetails?.time);

  usePreloadYearBests(athletes, isSubscribed === true);
  const athleteBests = useYearBestsForSort(athletes, isBestLiftSort(filters.sort));

  const getSessionDetails = useMemo(() => buildSessionDetailsLookup(schedule), [schedule]);
  const normalizedAthletes = useMemo(() => normalizeStartListAthletes(athletes), [athletes]);
  const filteredAthletes = useMemo(
    () =>
      filterStartListAthletes(normalizedAthletes, filters, starredClubs).sort(
        compareStartListAthletes(filters.sort, athleteBests),
      ),
    [normalizedAthletes, filters, starredClubs, athleteBests],
  );

  const requirePremium = useCallback(
    (feature: string, message: string): boolean =>
      requirePremiumAction({ feature, message, returnPath: START_LIST_PATH }),
    [requirePremiumAction],
  );

  const handleSeeAllResults = useCallback(
    (request: AthleteRequest) => {
      if (!requirePremium("athlete-results", "Sign in to access premium features.")) return;
      router.push(athleteResultsHref(request));
    },
    [requirePremium, router],
  );

  const handleItemExpand = useCallback((index: number) => {
    setTimeout(() => {
      void listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.1 });
    }, 100);
  }, []);

  const renderListItem = useCallback(
    ({ item, index }: { item: LiftResult; index: number }) => (
      <AthleteItem
        athlete={item}
        router={router}
        getSessionDetails={getSessionDetails}
        onExpand={handleItemExpand}
        index={index}
        currentTheme={currentTheme}
        validMeet={selectedMeetName}
        meetZone={meetZone}
        isSubscribed={isSubscribed}
        onSeeAllResults={handleSeeAllResults}
      />
    ),
    [
      router,
      getSessionDetails,
      handleItemExpand,
      currentTheme,
      selectedMeetName,
      meetZone,
      isSubscribed,
      handleSeeAllResults,
    ],
  );

  const keyExtractor = useCallback(
    (item: LiftResult) => `${item.memberId}_${item.name}`,
    [],
  );

  const weightClassOptions = useMemo(
    () =>
      buildWeightClassOptions(athletes, {
        gender: filters.gender,
        ageGroup: filters.ageGroup,
        adaptive: filters.adaptive,
      }),
    [athletes, filters.gender, filters.ageGroup, filters.adaptive],
  );
  const ageGroupOptions = useMemo(() => buildAgeGroupOptions(athletes), [athletes]);
  const wsoOptions = useMemo(() => buildWsoOptions(athletes), [athletes]);
  const hasAdaptiveAthletes = useMemo(
    () => athletes.some((athlete) => athlete.adaptive === true),
    [athletes],
  );
  const openClubModal = useCallback(() => setShowClubModal(true), []);
  const pillConfigs = useMemo(
    () =>
      buildStartListPillConfigs({
        filters,
        ageGroups: ageGroupOptions,
        weightClasses: weightClassOptions,
        wsos: wsoOptions,
        hasAdaptiveAthletes,
        onOpenClubs: openClubModal,
      }),
    [
      filters,
      ageGroupOptions,
      weightClassOptions,
      wsoOptions,
      hasAdaptiveAthletes,
      openClubModal,
    ],
  );

  const handlePillSelect = useCallback(
    (id: string, value: string) => {
      if (isPremiumStartListPill(id, value) && isSubscribed !== true) {
        requirePremium("sort-athletes", "Sign in to access premium features.");
        return;
      }
      trackFilterApply();
      selectPill(id, value);
    },
    [isSubscribed, requirePremium, selectPill, trackFilterApply],
  );

  const handleSelectClub = useCallback(
    (club: string) => {
      trackFilterApply();
      setClub(club);
    },
    [setClub, trackFilterApply],
  );

  const handleToggleStarredClub = useCallback(
    (club: string) => {
      const next = toggleStarredClub(club);
      if (next.length === 0 && filters.club === STARRED_CLUBS_FILTER) {
        setClub("");
      }
    },
    [filters.club, setClub, toggleStarredClub],
  );

  const openSaveModal = useCallback(() => setShowSaveModal(true), []);
  useDownloadOptionsHeaderButton(openSaveModal);

  const handleSaveAll = () => {
    const authResult = requireAuth({
      feature: "save-session",
      message: "Sign in to save sessions and sync them across your devices.",
      returnPath: START_LIST_PATH,
    });
    if (authResult !== true) return;

    if (!selectedMeetName) {
      showToast({ type: "error", message: "Please select a meet before saving sessions." });
      return;
    }
    const validMeet = selectedMeetName;
    const count = filteredAthletes.length;

    Alert.alert(
      "Save Sessions",
      `Save sessions from ${count} athlete${count === 1 ? "" : "s"} to your saved list?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: async () => {
            try {
              showToast({ type: "info", message: "Saving sessions..." });
              const failure = describeSaveSessionsFailure(
                await saveAllFromAthletes(filteredAthletes, validMeet, schedule),
              );
              if (failure) {
                showToast({ type: "error", message: failure });
                return;
              }
              successNotification();
              Alert.alert("Success", "Sessions have been saved to your list.", [
                { text: "View Saved", onPress: () => router.push("/(tabs)/(saved)") },
                { text: "OK" },
              ]);
            } catch (error) {
              showToast({ type: "error", message: "Failed to save sessions." });
              console.error(error);
            }
          },
        },
      ],
    );
  };

  const handleSaveToCalendar = () => {
    if (!requireCalendarExport(START_LIST_PATH)) return;
    if (!selectedMeetName) {
      showToast({
        type: "error",
        message: "Please select a meet before adding events to calendar.",
      });
      return;
    }
    const { rows, unscheduled } = buildSessionExportRows(filteredAthletes, getSessionDetails);
    const { sessions, skipped } = groupCalendarSessions(rows, selectedMeetName, unscheduled);
    calendarExport.exportSessions(sessions, { skipped });
  };

  const confirmIncompleteShare = (included: number): Promise<boolean> => {
    const warning = describeIncompleteShare(filteredAthletes.length, included);
    if (!warning) return Promise.resolve(true);
    return new Promise((resolve) => {
      Alert.alert(
        "Some Athletes Are Missing",
        warning,
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Share Anyway", onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
  };

  const canShareSchedule = (): boolean => {
    if (!shareGroup) {
      showToast({ type: "info", message: SELECT_SHARE_GROUP_MESSAGE });
      return false;
    }
    if (filteredAthletes.length === 0) {
      showToast({ type: "info", message: NO_ATHLETES_MESSAGE });
      return false;
    }
    return true;
  };

  const handleCreateShareableSchedule = async () => {
    if (!requirePremium("share-schedule-image", "Sign in to share schedule images.")) return;
    if (!canShareSchedule()) return;
    const { rows } = buildSessionExportRows(filteredAthletes, getSessionDetails);
    if (!(await confirmIncompleteShare(rows.length))) return;

    await shareImages.captureImages();
  };

  const handleDownloadShareableSchedule = async () => {
    if (!requirePremium("export-csv", "Sign in to export schedules.")) return;
    if (!canShareSchedule()) return;

    const { rows } = buildSessionExportRows(filteredAthletes, getSessionDetails);
    if (!(await confirmIncompleteShare(rows.length))) return;
    const csv = buildScheduleCsv(rows, { group: shareGroup, meet: selectedMeet || "" });
    try {
      const shared = await shareScheduleCsv(csv, scheduleCsvFileName(shareGroup, Date.now()));
      if (!shared) {
        showToast({ type: "info", message: "Sharing is not available on this device." });
      }
    } catch (error) {
      console.error("Error generating CSV:", error);
      showToast({ type: "error", message: "Failed to generate CSV. Please try again." });
    }
  };

  if (loading) {
    return <StartListSkeleton />;
  }

  const loadFailureText =
    loadFailure && !isFiltering ? loadFailureCopy("start list", loadFailure === "offline") : null;

  return (
    <ThemedView
      testID="start-list-screen"
      style={[styles.container, { backgroundColor: colors.background }, screenInsets]}
      key={selectedMeet}
    >
      <View
        style={[
          styles.filterContainer,
          {
            backgroundColor: colors.background,
            borderBottomColor: colors.borderBottom,
            borderBottomWidth: 1,
          },
        ]}
      >
        <StartListSearchBar value={filters.search} onChangeText={setSearch} colors={colors} />

        <View style={styles.pillBarContainer}>
          <FilterPillBar
            configs={pillConfigs}
            onSelect={handlePillSelect}
            hasActiveFilters={hasActiveFilters}
            onReset={resetFilters}
          />
        </View>
      </View>

      <View style={styles.listWrapper}>
        <ExpandedIdProvider>
          <FlashList
            ref={listRef}
            data={filteredAthletes}
            keyExtractor={keyExtractor}
            renderItem={renderListItem}
            removeClippedSubviews={false}
            drawDistance={350}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: 80 + insets.bottom },
            ]}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <StartListEmptyState
                loadFailureText={loadFailureText}
                isOfflineFailure={loadFailure === "offline"}
                isFiltering={isFiltering}
                onRetry={() => {
                  void refresh();
                }}
                onClearFilters={resetFilters}
                colors={colors}
              />
            }
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={refresh}
                tintColor={colors.text}
              />
            }
          />
        </ExpandedIdProvider>
      </View>

      <ClubFilterModal
        visible={showClubModal}
        onClose={() => setShowClubModal(false)}
        athletes={athletes}
        starredClubs={starredClubs}
        onToggleStarredClub={handleToggleStarredClub}
        selectedClub={filters.club}
        onSelectClub={handleSelectClub}
      />

      <ActionModal
        visible={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        athleteCount={filteredAthletes.length}
        isSubscribed={isSubscribed}
        onSaveAll={handleSaveAll}
        onSaveToCalendar={handleSaveToCalendar}
        onCreateShareableSchedule={handleCreateShareableSchedule}
        onDownloadShareableSchedule={handleDownloadShareableSchedule}
      />

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

      {shareImages.captureViewsMounted && (
        <ShareScheduleCaptureViews
          shareImages={shareImages}
          filteredAthletes={filteredAthletes}
          selectedMeet={selectedMeet || ""}
          selectedGroup={shareGroup}
          getSessionDetails={getSessionDetails}
        />
      )}

      <ImagePreviewModal
        visible={shareImages.preview.visible}
        whiteImageUri={shareImages.preview.whiteImageUri}
        transparentImageUri={shareImages.preview.transparentImageUri}
        selectedIndex={shareImages.preview.selectedIndex}
        onChangeIndex={shareImages.preview.onChangeIndex}
        onClose={shareImages.preview.onClose}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listWrapper: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 12,
  },
  filterContainer: {
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  pillBarContainer: {
    marginTop: 12,
    marginHorizontal: -16,
  },
});
