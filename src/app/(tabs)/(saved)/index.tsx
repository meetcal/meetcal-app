import { CalendarDestinationPickerModal } from "@/components/calendar/CalendarDestinationPickerModal";
import { NextSessionCard } from "@/components/saved/NextSessionCard";
import SessionCard from "@/components/saved/SessionCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { showToast } from "@/components/ui/Toast";
import { useSavedSessions } from "@/contexts/SavedSessionsContext";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useAppColors } from "@/hooks/useAppColors";
import { useCalendarSessionsExport } from "@/hooks/useCalendarSessionsExport";
import { useSavedScheduleLookup } from "@/hooks/saved-sessions/useSavedScheduleLookup";
import { calendarSessionsFromSaved } from "@/lib/calendar-export";
import { countSessionsOutsideMeet } from "@/lib/saved-sessions-list";
import { LegacySavedSession } from "@/types/saved";
import { useAuthGuard } from "@/utils/authGuard";
import { useUser } from "@clerk/expo";
import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";
import { devLog } from "@/lib/logger";
import { premiumActionFor, resolvePremiumAccess } from "@/lib/premium-access";

export default function SavedScreen() {
  const screenInsets = useScreenHorizontalInsets();
  const { user } = useUser();
  const {
    savedSessions,
    isLoading,
    authExpired,
    syncFailed,
    loadSavedSessions,
    resetAllSessions,
    migrateLegacySessions,
  } = useSavedSessions();
  const { selectedMeet, availableMeets, meetDetails } = useSelectedMeet();
  const allowedMeetNames = useMemo(
    () => new Set(availableMeets.map((m) => m.name)),
    [availableMeets],
  );
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [hasMigrated, setHasMigrated] = useState(false);
  const { isSubscribed, isLoading: isSubscriptionLoading } = useSubscription();
  const { requireAuth } = useAuthGuard();
  const colors = useAppColors();
  const { exportSessions: exportToCalendar, picker: calendarPicker } =
    useCalendarSessionsExport();
  // Only until the first load has finished: a focus refresh of a list that
  // is legitimately empty must not flash a spinner every time.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(!isLoading);
  useEffect(() => {
    if (!isLoading) setHasLoadedOnce(true);
  }, [isLoading]);
  const loadSavedSessionsRef = React.useRef(loadSavedSessions);

  useEffect(() => {
    loadSavedSessionsRef.current = loadSavedSessions;
  }, [loadSavedSessions]);

  useFocusEffect(
    useCallback(() => {
      void loadSavedSessionsRef.current();
    }, []),
  );

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

    // The hook clears the selected meet only (legacy storage keys included),
    // or everything when no meet is selected. Say which one is about to happen.
    const scope = selectedMeet ? `for ${selectedMeet}` : "for every meet";
    Alert.alert(
      "Reset Saved Sessions",
      `Remove all saved sessions ${scope}? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            const reset = await resetAllSessions(selectedMeet ?? undefined);
            if (reset) {
              showToast({
                type: "success",
                message: selectedMeet
                  ? "All saved sessions for this meet have been reset."
                  : "All saved sessions have been reset.",
              });
            } else {
              showToast({ type: "error", message: "Failed to reset saved sessions." });
            }
          },
        },
      ],
    );
  }, [requireAuth, user, resetAllSessions, selectedMeet]);

  // `meetDetails.time.abbreviation` is resolved once, in `mapApiMeet`, at the
  // meet's own start date. Re-deriving it here with
  // `getTimeZoneAbbreviation(id)` formats *today* instead: open a December New
  // York meet in September and every row reads "EDT" when the sessions are
  // actually EST, which looks to the user like the times are an hour wrong.
  const timeZoneAbbr = meetDetails?.time.abbreviation ?? "";

  // Only the selected meet's schedule: it is the only meet this tab lists.
  const { sessionLookupByMeet, isLoading: isSchedulesLoading } =
    useSavedScheduleLookup(savedSessions, selectedMeet, allowedMeetNames);

  // Pre-meet rows are folded into the current list by the hook, which owns
  // the storage keys; this screen only decides when to ask.
  const migrateSessions = useCallback(async () => {
    if (!user?.id || !selectedMeet) return;
    devLog("Starting session migration");
    await migrateLegacySessions(selectedMeet);
    setHasMigrated(true);
  }, [selectedMeet, migrateLegacySessions, user?.id]);

  // Only the selected meet's sessions are listed.
  const filteredSessions = useMemo(
    () =>
      savedSessions
        .filter((session) => session.meet === selectedMeet)
        .sort((a, b) => a.sessionNumber - b.sessionNumber),
    [savedSessions, selectedMeet],
  );
  const otherMeetSessionCount = useMemo(
    () => countSessionsOutsideMeet(savedSessions, selectedMeet),
    [savedSessions, selectedMeet],
  );

  const handleSaveToCalendar = useCallback(() => {
    // 1. Check authentication first
    const authResult = requireAuth({
      feature: "add-to-calendar",
      message: "Sign in to add sessions to your calendar.",
      returnPath: "/(tabs)/(saved)",
    });
    if (authResult === null || authResult === false) {
      return;
    }

    // 2. Then check subscription. Unknown says so; it never opens the
    // paywall in front of a subscriber whose entitlement can't be confirmed.
    const premium = premiumActionFor(
      resolvePremiumAccess({ isSubscribed, isLoading: isSubscriptionLoading }),
    );
    if (premium.kind === "notify") {
      showToast(premium.toast);
      return;
    }
    if (premium.kind === "paywall") {
      router.push({
        pathname: "/shared-screens/paywall",
        params: {
          from: "/(tabs)/(saved)",
          feature: "add-to-calendar",
        },
      });
      return;
    }

    if (filteredSessions.length === 0) {
      showToast({ type: "info", message: "There are no sessions to add to calendar." });
      return;
    }
    // Check if schedules are still loading
    if (isSchedulesLoading) {
      showToast({
        type: "info",
        message: "Schedule data is still loading, please wait a moment.",
      });
      return;
    }

    const { sessions, skipped } = calendarSessionsFromSaved(
      filteredSessions,
      sessionLookupByMeet,
      allowedMeetNames,
    );
    exportToCalendar(sessions, { skipped });
  }, [requireAuth, isSubscribed, isSubscriptionLoading, router, filteredSessions, isSchedulesLoading, sessionLookupByMeet, allowedMeetNames, exportToCalendar]);

  const forceLoadSessions = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      devLog("Force reloading sessions from source...");
      await loadSavedSessions();
    } catch (error) {
      console.error("Error force reloading sessions:", error);
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, loadSavedSessions]);

  // Built once for the whole list instead of once per row. `SessionCard` is
  // `React.memo`, and every other prop it takes is already stable, so a
  // per-row `onPress` closure was the single reason the memo never once
  // short-circuited: each of this screen's re-renders (pull-to-refresh, the
  // calendar picker, and each commit of a Save All) re-rendered every visible
  // card instead of none of them.
  const handleSessionPress = useCallback(
    (session: LegacySavedSession) => {
      router.push({
        pathname: "/shared-screens/schedule-details",
        params: {
          ...session,
          startTime: session.startTime,
          weighInTime: session.weighInTime,
          meet: session.meet || selectedMeet || "",
        },
      });
    },
    [router, selectedMeet],
  );

  const renderSession = useCallback(
    ({ item }: { item: LegacySavedSession }) => {
      return (
        <SessionCard
          item={item}
          selectedMeet={selectedMeet}
          onPress={handleSessionPress}
          sessionLookupByMeet={sessionLookupByMeet}
          allowedMeetNames={allowedMeetNames}
          timeZoneAbbr={timeZoneAbbr}
        />
      );
    },
    [
      selectedMeet,
      handleSessionPress,
      sessionLookupByMeet,
      allowedMeetNames,
      timeZoneAbbr,
    ],
  );

  useEffect(() => {
    if (!hasMigrated) {
      migrateSessions();
    }
  }, [hasMigrated, migrateSessions]);

  useLayoutEffect(() => {
    const calendarIconColor = isSchedulesLoading
      ? colors.border
      : isSubscribed
        ? colors.text
        : colors.secondaryText;

    // Native UIBarButtonItems on iOS so they move into iPhone Duo's vertical bar.
    if (Platform.OS === "ios") {
      navigation.setOptions({
        unstable_headerRightItems: () => [
          {
            type: "button",
            label: "Add to calendar",
            icon: { type: "sfSymbol", name: "calendar" },
            tintColor: calendarIconColor,
            disabled: isSchedulesLoading,
            onPress: handleSaveToCalendar,
          },
          {
            type: "button",
            label: "Delete all saved sessions",
            icon: { type: "sfSymbol", name: "trash" },
            tintColor: colors.danger,
            onPress: handleResetSessions,
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
      testID="saved-screen"
      style={[styles.container, { backgroundColor: colors.background }, screenInsets]}
    >
      <FlatList
        data={filteredSessions}
        keyExtractor={(item) => item.id}
        renderItem={renderSession}
        contentContainerStyle={[
          styles.list,
          filteredSessions.length === 0 && styles.listEmpty,
          { paddingBottom: insets.bottom + 100 },
        ]}
        ListHeaderComponent={
          <>
            {authExpired ? (
              <View
                testID="saved-sync-notice"
                style={[styles.syncNotice, { borderColor: colors.border }]}
              >
                <ThemedText style={[styles.syncNoticeText, { color: colors.secondaryText }]}>
                  Your sign-in has expired, so saved sessions are not syncing.
                  Sign out and back in to sync them again.
                </ThemedText>
              </View>
            ) : syncFailed ? (
              <View
                testID="saved-sync-failed-notice"
                style={[styles.syncNotice, { borderColor: colors.border }]}
              >
                <ThemedText style={[styles.syncNoticeText, { color: colors.secondaryText }]}>
                  Couldn&apos;t sync saved sessions. Showing the copy saved on
                  this device; pull down to try again.
                </ThemedText>
              </View>
            ) : null}
            <NextSessionCard
              selectedMeet={selectedMeet}
              meetDetails={meetDetails}
              savedSessions={savedSessions}
            />
          </>
        }
        ListEmptyComponent={() =>
          !hasLoadedOnce ? (
            <View testID="saved-loading-state" style={[styles.emptyContainer, styles.loading]}>
              <ActivityIndicator color={colors.secondaryText} />
            </View>
          ) : (
            <View testID="saved-empty-state" style={styles.emptyContainer}>
              <EmptyState
                icon={
                  <IconSymbol
                    name="bookmark.fill"
                    size={48}
                    color={colors.secondaryText}
                  />
                }
                title={
                  otherMeetSessionCount > 0
                    ? "No saved sessions for this meet"
                    : "No saved sessions"
                }
                message={
                  otherMeetSessionCount > 0
                    ? `You have ${otherMeetSessionCount} saved session${otherMeetSessionCount === 1 ? "" : "s"} for other meets. Switch meets to see ${otherMeetSessionCount === 1 ? "it" : "them"}.`
                    : "Save sessions from the schedule to see them here"
                }
                actionLabel="Browse Schedule"
                onActionPress={() => router.push("/(tabs)/(index)")}
              />
            </View>
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={forceLoadSessions}
            colors={[colors.link]}
            tintColor={colors.text}
          />
        }
      />
      <CalendarDestinationPickerModal
        visible={calendarPicker.visible}
        title="Choose Calendar"
        destinations={calendarPicker.destinations}
        onClose={calendarPicker.onClose}
        onSelect={(destination) => {
          void calendarPicker.onSelect(destination);
        }}
        isLoading={calendarPicker.isLoading}
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
  listEmpty: {
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    minHeight: 320,
  },
  loading: {
    alignItems: "center",
    justifyContent: "center",
  },
  syncNotice: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  syncNoticeText: {
    fontSize: 13,
  },
});
