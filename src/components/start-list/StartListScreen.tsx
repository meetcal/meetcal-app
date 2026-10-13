import { CalendarDestinationPickerModal } from "@/components/calendar/CalendarDestinationPickerModal";
import ImagePreviewModal from "@/components/share/ImagePreviewModal";
import ShareScheduleView from "@/components/share/ShareScheduleView";
import ActionModal from "@/components/start-list/ActionModal";
import { AthleteItem } from "@/components/start-list/AthleteItem";
import { StartListSearchBar } from "@/components/start-list/StartListSearchBar";
import { StartListSkeleton } from "@/components/start-list/StartListSkeleton";
import { buildStartListPillConfigs } from "@/components/start-list/startListPills";
import { EmptyState } from "@/components/ui/EmptyState";
import { ClubFilterModal, FilterPillBar } from "@/components/ui/filters";
import { IconSymbol } from "@/components/ui/IconSymbol";
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
import { useFilterApplyReviewPrompt } from "@/hooks/useFilterApplyReviewPrompt";
import { useMeetZone } from "@/hooks/useMeetZone";
import { useRequirePremium } from "@/hooks/useRequirePremium";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";
import { useStarredClubs } from "@/hooks/useStarredClubs";
import { useStartListData } from "@/hooks/useStartListData";
import { usePreloadYearBests, useYearBestsForSort } from "@/hooks/useStartListBests";
import { useStartListFilters } from "@/hooks/useStartListFilters";
import { groupCalendarSessions } from "@/lib/calendar-export";
import { lightImpact, successNotification } from "@/lib/haptics";
import { loadFailureCopy } from "@/lib/load-failure";
import { describeSaveSessionsFailure } from "@/lib/saved-sessions-actions";
import { captureViewAsPng } from "@/lib/share-image";
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
  getSaveIcon,
  getShareGroup,
  hasActiveStartListFilters,
  isBestLiftSort,
  isPremiumStartListPill,
  normalizeStartListAthletes,
  STARRED_CLUBS_FILTER,
} from "@/lib/start-list-utils";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { useNavigation, useRouter } from "expo-router";
import React, {
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
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Where sign-in and the paywall send the user back to. */
const START_LIST_PATH = "/(tabs)/(start-list)";

/**
 * Render width of the shareable schedule image, in points. Fixed so the PNG is
 * the same size on every device; `ImagePreviewModal` assumes it too.
 */
const SHARE_IMAGE_WIDTH = 850;

const SELECT_SHARE_GROUP_MESSAGE =
  "Select a specific club or WSO from the filters to create a shareable schedule.";
const NO_ATHLETES_MESSAGE = "No athletes were found for the current filters.";
const IMAGE_FAILED_MESSAGE = "Failed to generate schedule image. Please try again.";

/**
 * The Start List tab: the selected meet's roster with search, filter pills
 * and the download actions (save, calendar, share image, CSV).
 *
 * Loading, filters, starred clubs, the review prompt and the calendar export
 * live in hooks; filtering, sorting, option building and the exports are
 * tested helpers in `start-list-utils` / `start-list-export`. This component
 * wires them to the UI and runs the sign-in / subscription gates.
 */
export default function StartListScreen() {
  const screenInsets = useScreenHorizontalInsets();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
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
  const [generatedImageWhiteUri, setGeneratedImageWhiteUri] = useState<string | null>(null);
  const [generatedImageTransparentUri, setGeneratedImageTransparentUri] =
    useState<string | null>(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [showImagePreview, setShowImagePreview] = useState(false);
  const [showShareViews, setShowShareViews] = useState(false);
  const shareScheduleRef = useRef<React.ComponentRef<typeof View>>(null);
  const shareScheduleTransparentRef = useRef<React.ComponentRef<typeof View>>(null);
  const skeletonPulse = useRef(new Animated.Value(0.4)).current;
  const listRef = useRef<FlashListRef<LiftResult>>(null);

  // A best-lift sort only applies while the subscription is confirmed.
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

  // Row inputs, resolved once here instead of once per mounted row (see
  // `AthleteRowProps`). Each row labels its time with the zone at its own
  // session date (`meetTimeZoneLabel`); `useMeetZone` keeps the zone's
  // identity across meets refreshes, so the memoized rows do not re-render.
  const selectedMeetName =
    selectedMeet && isMeetName(selectedMeet) ? selectedMeet : null;
  const meetZone = useMeetZone(meetDetails?.time);

  usePreloadYearBests(athletes);
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

  useEffect(() => {
    if (!loading) return;
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
  }, [loading, skeletonPulse]);

  /**
   * Sign-in, then the subscription: `true` only for a signed-in subscriber.
   * A free user is sent to the paywall with a way back here; an unknown
   * entitlement (offline, or still checking) says so in a toast and never
   * opens the paywall (see `useRequirePremium` / `lib/premium-access`).
   */
  const requirePremium = useCallback(
    (feature: string, message: string): boolean =>
      requirePremiumAction({ feature, message, returnPath: START_LIST_PATH }),
    [requirePremiumAction],
  );

  const handleSeeAllResults = useCallback(
    (athleteName: string) => {
      if (!requirePremium("athlete-results", "Sign in to access premium features.")) return;
      router.push({
        pathname: "/shared-screens/athlete-results",
        params: { name: athleteName },
      });
    },
    [requirePremium, router],
  );

  const handleItemExpand = useCallback((index: number) => {
    setTimeout(() => {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.1 });
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
      // Best-lift sorts are premium (see `isPremiumStartListPill`).
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
      // The "Favorites" filter cannot outlive the set it filters on. The star
      // toggle lives inside the club sheet, so unstarring the last club while
      // Favorites was selected left every athlete filtered out, and the sheet
      // stopped rendering the Favorites row (it is gated on
      // `starredClubs.length > 0`), so nothing in it showed as selected.
      if (next.length === 0 && filters.club === STARRED_CLUBS_FILTER) {
        setClub("");
      }
    },
    [filters.club, setClub, toggleStarredClub],
  );

  useLayoutEffect(() => {
    // Native UIBarButtonItem on iOS so it moves into iPhone Duo's vertical bar.
    if (Platform.OS === "ios") {
      navigation.setOptions({
        unstable_headerRightItems: () => [
          {
            type: "button",
            label: "Open download options",
            icon: { type: "sfSymbol", name: "square.and.arrow.down" },
            onPress: () => setShowSaveModal(true),
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
            onPress={() => setShowSaveModal(true)}
            accessibilityRole="button"
            accessibilityLabel="Open download options"
          >
            <IconSymbol name={getSaveIcon()} size={24} color={colors.text} />
          </Pressable>
        </View>
      ),
    });
  }, [colors.text, navigation]);

  const handleSaveAll = () => {
    // Saving writes to the signed-in user's list, so sign-in comes first, as
    // on every other save path. `saveAllFromAthletes` saves nothing
    // without a user, which used to surface as "Failed to save sessions."
    // after the confirmation instead of a sign-in prompt. `null` is "still
    // loading"; `false` means the sign-in alert has already been shown.
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
    // Untimed sessions and athletes the schedule cannot place yet are left
    // out and counted, so the toast says "Added N of M".
    const { rows, unscheduled } = buildSessionExportRows(filteredAthletes, getSessionDetails);
    const { sessions, skipped } = groupCalendarSessions(rows, selectedMeetName, unscheduled);
    calendarExport.exportSessions(sessions, { skipped });
  };

  /**
   * Resolves `true` to share a schedule holding `included` of the athletes
   * on screen; when some are missing (no session on the schedule yet), only
   * after the user agrees to share it anyway.
   */
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

  /** The share actions need one club or WSO and at least one athlete. */
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

    try {
      setShowShareViews(true);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

      if (!shareScheduleRef.current || !shareScheduleTransparentRef.current) {
        setShowShareViews(false);
        showToast({ type: "error", message: IMAGE_FAILED_MESSAGE });
        return;
      }

      // Add a small delay to ensure the view is fully rendered
      await new Promise((resolve) => setTimeout(resolve, 100));

      const [whiteUri, transparentUri] = await Promise.all([
        captureViewAsPng(shareScheduleRef.current, { width: SHARE_IMAGE_WIDTH }),
        captureViewAsPng(shareScheduleTransparentRef.current, { width: SHARE_IMAGE_WIDTH }),
      ]);
      setGeneratedImageWhiteUri(whiteUri);
      setGeneratedImageTransparentUri(transparentUri);
      setSelectedImageIndex(0);
      lightImpact();
      setShowImagePreview(true);
    } catch (error) {
      setShowShareViews(false);
      console.error("Error capturing image:", error);
      showToast({ type: "error", message: IMAGE_FAILED_MESSAGE });
    }
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
    return <StartListSkeleton skeletonPulse={skeletonPulse} />;
  }

  // Not "Athletes will appear here once the start list is published": the
  // roster could not be loaded (offline with nothing saved, or a failed
  // request). A filtered or searched list keeps its own empty state.
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
            // No `extraData`: FlashList compares it by identity
            // (`ViewHolder`'s memo does `prevProps.extraData === nextProps.extraData`),
            // so an object literal here re-rendered every mounted cell on every
            // render of this screen — and this screen re-renders for a lot of
            // reasons that have nothing to do with the rows (auth guard, the
            // four contexts it reads, modal state, `athleteBests` arriving).
            // It was redundant anyway: all the filter values are already
            // dependencies of `filteredAthletes`, which allocates a new array,
            // so `data` identity already changes whenever any of them does.
            data={filteredAthletes}
            keyExtractor={keyExtractor}
            renderItem={renderListItem}
            removeClippedSubviews={false}
            drawDistance={350}
            // With the search keyboard up, the first tap on an athlete expands
            // the row instead of only hiding the keyboard.
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: 80 + insets.bottom },
            ]}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              loadFailureText ? (
                <EmptyState
                  style={styles.listEmpty}
                  icon={
                    <IconSymbol
                      name={loadFailure === "offline" ? "wifi.slash" : "arrow.clockwise"}
                      size={44}
                      color={colors.secondaryText}
                    />
                  }
                  title={loadFailureText.title}
                  message={loadFailureText.message}
                  actionLabel="Retry"
                  onActionPress={() => {
                    void refresh();
                  }}
                />
              ) : (
                <EmptyState
                  style={styles.listEmpty}
                  icon={
                    <IconSymbol
                      name={isFiltering ? "magnifyingglass" : "list.bullet"}
                      size={44}
                      color={colors.secondaryText}
                    />
                  }
                  title={isFiltering ? "No athletes match your filters" : "No athletes yet"}
                  message={
                    isFiltering
                      ? "Try adjusting or clearing your filters to see more athletes."
                      : "Athletes will appear here once the start list is published."
                  }
                  actionLabel={isFiltering ? "Clear filters" : undefined}
                  onActionPress={isFiltering ? resetFilters : undefined}
                />
              )
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

      {showShareViews && (
        <View style={styles.offscreen}>
          <View ref={shareScheduleRef} collapsable={false}>
            <ShareScheduleView
              filteredAthletes={filteredAthletes}
              selectedMeet={selectedMeet || ""}
              selectedGroup={shareGroup}
              getSessionDetails={getSessionDetails}
              backgroundPreset="white"
            />
          </View>
          <View ref={shareScheduleTransparentRef} collapsable={false}>
            <ShareScheduleView
              filteredAthletes={filteredAthletes}
              selectedMeet={selectedMeet || ""}
              selectedGroup={shareGroup}
              getSessionDetails={getSessionDetails}
              backgroundPreset="transparent"
            />
          </View>
        </View>
      )}

      <ImagePreviewModal
        visible={showImagePreview}
        whiteImageUri={generatedImageWhiteUri}
        transparentImageUri={generatedImageTransparentUri}
        selectedIndex={selectedImageIndex}
        onChangeIndex={setSelectedImageIndex}
        onClose={() => {
          setShowImagePreview(false);
          setGeneratedImageWhiteUri(null);
          setGeneratedImageTransparentUri(null);
          setShowShareViews(false);
        }}
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
  listEmpty: {
    paddingTop: 64,
  },
  filterContainer: {
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  headerIconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  pillBarContainer: {
    marginTop: 12,
    marginHorizontal: -16,
  },
  offscreen: {
    position: "absolute",
    left: -10000,
    top: 0,
  },
});
