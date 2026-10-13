import { RateBar } from "@/components/athlete-results/RateBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { AppColors, useAppColors } from "@/hooks/useAppColors";
import { useIsOffline } from "@/hooks/useIsOffline";
import { useRetryOnReconnect } from "@/hooks/useRetryOnReconnect";
import { calculateAthleteMakeRates } from "@/lib/athlete-make-rates";
import { findPRIndexes, type PRIndexes } from "@/lib/athlete-prs";
import { getAllCachedLiftingResultsForAthlete } from "@/lib/database/offline-store";
import { fetchAllResultsForName } from "@/lib/database/queries";
import {
  loadAthleteResults,
  partialResultsStatus,
  showsCareerStats,
  type AthleteResultsOutcome,
  type ShownResultsSource,
} from "@/lib/athlete-results-load";
import { loadFailureCopy } from "@/lib/load-failure";
import { SupabaseLiftResult } from "@/types/athlete-results";
import { FlashList } from "@shopify/flash-list";
import { Stack, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SubscriptionGate } from "@/components/ui/SubscriptionGate";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";
import { Palette } from "@/constants/Palette";

/**
 * A meet result date is a calendar date, not an instant. `new Date("2025-03-15")`
 * is UTC midnight, so formatting it in the device timezone shows 3/14/2025 on
 * every US device. Format in UTC and it reads back as the date the meet held.
 */
function formatResultDate(date: string | null | undefined): string {
  if (!date) return "";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, { timeZone: "UTC" });
}

function getRateColor(rate: number, colors: AppColors) {
  if (rate >= 80) return colors.success;
  if (rate < 70) return colors.fail;
  return "#FF9500";
}

function AttemptRateRow({
  attemptNumber,
  rates,
  colors,
}: {
  attemptNumber: number;
  rates: { makes: number; total: number; rate: number };
  colors: AppColors;
}) {
  return (
    <View style={styles.attemptRateRow}>
      <ThemedText
        style={[styles.attemptRateLabel, { color: colors.secondaryText }]}
      >
        {attemptNumber}
      </ThemedText>
      <ThemedText
        style={[styles.attemptRateValue, { color: getRateColor(rates.rate, colors) }]}
      >
        {rates.rate.toFixed(1)}
%
</ThemedText>
      <ThemedText
        style={[styles.attemptRateSubtext, { color: colors.secondaryText }]}
      >
        {rates.makes}
/
{rates.total}
      </ThemedText>
    </View>
  );
}

function AthleteStats({
  results,
  colors,
}: {
  results: SupabaseLiftResult[];
  colors: AppColors;
}) {
  const stats = useMemo(() => calculateAthleteMakeRates(results), [results]);

  return (
    <Animated.View
      entering={FadeIn.duration(400)}
      style={[styles.card, { backgroundColor: colors.card, marginTop: 16 }]}
    >
      <View style={[styles.section, { borderBottomColor: colors.border }]}>
        <ThemedText style={styles.meetName}>Success Rates</ThemedText>
      </View>

      <View style={styles.statsGrid}>
        {/* Snatch Column */}
        <View style={styles.statsColumn}>
          <View style={styles.liftHeader}>
            <ThemedText
              style={[styles.liftName, { color: colors.secondaryText }]}
            >
              Snatch
            </ThemedText>
            <ThemedText
              style={[
                styles.statsValue,
                { color: getRateColor(stats.snatchMakeRate, colors) },
              ]}
            >
              {stats.snatchMakeRate.toFixed(1)}
%
</ThemedText>
          </View>
          <View style={styles.rateBarWrap}>
            <RateBar
              rate={stats.snatchMakeRate}
              color={getRateColor(stats.snatchMakeRate, colors)}
            />
          </View>
          <View style={styles.attemptRatesContainer}>
            <AttemptRateRow
              attemptNumber={1}
              rates={stats.snatchAttemptRates.attempt1}
              colors={colors}
            />
            <AttemptRateRow
              attemptNumber={2}
              rates={stats.snatchAttemptRates.attempt2}
              colors={colors}
            />
            <AttemptRateRow
              attemptNumber={3}
              rates={stats.snatchAttemptRates.attempt3}
              colors={colors}
            />
          </View>
        </View>

        {/* Vertical Divider */}
        <View
          style={[styles.verticalDivider, { backgroundColor: colors.border }]}
        />

        {/* Clean & Jerk Column */}
        <View style={styles.statsColumn}>
          <View style={styles.liftHeader}>
            <ThemedText
              style={[styles.liftName, { color: colors.secondaryText }]}
            >
              C&J
            </ThemedText>
            <ThemedText
              style={[
                styles.statsValue,
                { color: getRateColor(stats.cjMakeRate, colors) },
              ]}
            >
              {stats.cjMakeRate.toFixed(1)}
%
</ThemedText>
          </View>
          <View style={styles.rateBarWrap}>
            <RateBar
              rate={stats.cjMakeRate}
              color={getRateColor(stats.cjMakeRate, colors)}
            />
          </View>
          <View style={styles.attemptRatesContainer}>
            <AttemptRateRow
              attemptNumber={1}
              rates={stats.cjAttemptRates.attempt1}
              colors={colors}
            />
            <AttemptRateRow
              attemptNumber={2}
              rates={stats.cjAttemptRates.attempt2}
              colors={colors}
            />
            <AttemptRateRow
              attemptNumber={3}
              rates={stats.cjAttemptRates.attempt3}
              colors={colors}
            />
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

/**
 * One meet card. Roughly 25 native views, and an athlete's career runs to ~90
 * meets, so these are rendered through a virtualized list rather than mounted
 * all at once. Memoized because FlashList recycles cells: without it every
 * scroll step re-renders cards whose props did not change.
 */
const MeetResultCard = React.memo(function MeetResultCard({
  result,
  colors,
  isSnatchPR,
  isCJPR,
  isTotalPR,
  isFirst,
}: {
  result: SupabaseLiftResult;
  colors: AppColors;
  isSnatchPR: boolean;
  isCJPR: boolean;
  isTotalPR: boolean;
  isFirst: boolean;
}) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card },
        isFirst && { marginTop: 16 },
      ]}
    >
      <View style={[styles.section, { borderBottomColor: colors.border }]}>
        <View style={styles.meetNameRow}>
          <ThemedText style={styles.meetName}>
            {result.meet}
          </ThemedText>
          {isSnatchPR || isCJPR || isTotalPR ? (
            <View style={[styles.prBadge, { backgroundColor: colors.prBadge }]}>
              <ThemedText style={styles.prBadgeText}>PR</ThemedText>
            </View>
          ) : null}
        </View>
        <ThemedText style={[styles.meetDate, { color: colors.secondaryText }]}>
          Date: {formatResultDate(result.date)}
        </ThemedText>
        <ThemedText
          style={[styles.weightClass, { color: colors.secondaryText }]}
        >
          {result.age}
        </ThemedText>
      </View>

      <View style={[styles.section, { borderBottomColor: colors.border }]}>
        <View style={styles.liftRow}>
          <ThemedText style={[styles.liftName, { color: colors.secondaryText }]}>
            Snatch
          </ThemedText>
          <View style={styles.attempts}>
            <AttemptDisplay attempt={result.snatch1} colors={colors} />
            <AttemptDisplay attempt={result.snatch2} colors={colors} />
            <AttemptDisplay attempt={result.snatch3} colors={colors} />
          </View>
        </View>
      </View>

      <View style={[styles.section, { borderBottomColor: colors.border }]}>
        <View style={styles.liftRow}>
          <ThemedText style={[styles.liftName, { color: colors.secondaryText }]}>
            Clean & Jerk
          </ThemedText>
          <View style={styles.attempts}>
            <AttemptDisplay attempt={result.cj1} colors={colors} />
            <AttemptDisplay attempt={result.cj2} colors={colors} />
            <AttemptDisplay attempt={result.cj3} colors={colors} />
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <ThemedText style={styles.total}>
          <ThemedText
            style={[styles.total, isSnatchPR && { color: colors.prText }]}
          >
            {result.snatch_best ?? "—"}
          </ThemedText>
          /
          <ThemedText
            style={[styles.total, isCJPR && { color: colors.prText }]}
          >
            {result.cj_best ?? "—"}
          </ThemedText>
          /
          <ThemedText
            style={[styles.total, isTotalPR && { color: colors.prText }]}
          >
            {result.total ?? "—"}
          </ThemedText>
        </ThemedText>
      </View>
    </View>
  );
});

/** No meet is a PR: what the on-device copy shows (see `showsCareerStats`). */
const NO_PR_INDEXES: PRIndexes = { snatch: -1, cj: -1, total: -1 };

function meetResultKey(result: SupabaseLiftResult, index: number): string {
  return `${result.event_id}-${result.meet}-${result.date}-${result.name}-${index}`;
}

/**
 * A premium screen. The buttons that open it check the subscription, but a
 * `meetcal://` deep link reaches the route directly, so it gates itself like
 * every other premium screen.
 */
export default function AthleteResultsScreen() {
  return (
    <SubscriptionGate feature="athlete-results">
      <AthleteResultsContent />
    </SubscriptionGate>
  );
}

function AthleteResultsContent() {
  const screenInsets = useScreenHorizontalInsets();
  const colors = useAppColors();
  const { name } = useLocalSearchParams<{ name?: string }>();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [athleteResults, setAthleteResults] = useState<SupabaseLiftResult[]>(
    [],
  );
  // The request failed with nothing to show. Kept apart from an empty
  // answer: "No meet results found" read as "never competed" when the
  // device was only offline.
  const [loadFailed, setLoadFailed] = useState(false);
  // Where the rows on screen came from, and how the load ended (null while
  // the API request is in flight). On-device rows are a partial history.
  const [rowsSource, setRowsSource] = useState<ShownResultsSource | null>(null);
  const [loadOutcome, setLoadOutcome] = useState<AthleteResultsOutcome | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [isOffline] = useIsOffline();
  const resultsCacheRef = useRef<Map<string, SupabaseLiftResult[]>>(new Map());
  const requestIdRef = useRef(0);
  // The athlete whose on-device rows are on screen, and the rows, so a retry
  // for that athlete keeps them up (instead of blanking the list behind a
  // spinner) and the load knows they are there and partial.
  const offlineRowsRef = useRef<{ name: string; rows: SupabaseLiftResult[] } | null>(null);

  // Each cached entry can hold an athlete's entire competition history. Without
  // this cleanup the map grows for every athlete opened during a session and is
  // never released, steadily adding memory pressure that iOS punishes hardest.
  useEffect(() => {
    const cache = resultsCacheRef.current;
    return () => {
      cache.clear();
    };
  }, []);

  useEffect(() => {
    const fetchAthleteResults = async () => {
      if (!name) return;

      const nameStr = Array.isArray(name) ? name[0] : name;
      const cacheKey = `all::${nameStr}`;
      const cachedResults = resultsCacheRef.current.get(cacheKey);
      setLoadFailed(false);
      setLoadOutcome(null);
      if (cachedResults) {
        offlineRowsRef.current = null;
        setAthleteResults(cachedResults);
        setRowsSource("api");
        setLoading(false);
      } else if (offlineRowsRef.current?.name !== nameStr) {
        offlineRowsRef.current = null;
        setAthleteResults([]);
        setRowsSource(null);
        setLoading(true);
      }
      const keptOffline = cachedResults ? undefined : offlineRowsRef.current?.rows;

      const requestId = ++requestIdRef.current;
      try {
        // The offline copy is a fast first paint / offline fallback, never
        // the complete record; the full history from the API replaces it.
        // The API request starts before the offline read (see
        // `loadAthleteResults`).
        const outcome = await loadAthleteResults({
          shown: cachedResults ?? keptOffline,
          shownSource: cachedResults ? "api" : "offline",
          readOffline: () => getAllCachedLiftingResultsForAthlete(nameStr),
          fetchFull: () => fetchAllResultsForName(nameStr),
          isCurrent: () => requestId === requestIdRef.current,
          show: (rows, source) => {
            if (source === "api") {
              resultsCacheRef.current.set(cacheKey, rows);
            }
            offlineRowsRef.current = source === "offline" ? { name: nameStr, rows } : null;
            setAthleteResults(rows);
            setRowsSource(source);
            if (source === "offline") setLoading(false);
          },
        });
        if (outcome === "superseded") return;
        setLoadOutcome(outcome);
        if (outcome === "failed") setLoadFailed(true);
      } catch (error) {
        console.error("Error in fetchAthleteResults:", error);
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    };

    fetchAthleteResults();
    return () => {
      // Supersede the in-flight request: leaving the screen (or opening a
      // different athlete) must not repaint it with the previous results.
      requestIdRef.current += 1;
    };
  }, [name, retryCount]);

  // On-device rows stand in for the full history only until it can load:
  // the connection coming back, or the note's Retry, asks again.
  const retryLoad = useCallback(() => setRetryCount((count) => count + 1), []);
  useRetryOnReconnect(loadOutcome === "offline-partial", retryLoad);

  // For each lift, the index of the meet where the athlete's PR was set.
  // If the same best is hit at multiple meets, only the earliest one counts
  // as the PR — matching it later isn't a new PR.
  // Not from the on-device copy: it holds only the downloaded meets, and
  // one cached meet would read as a PR on every lift.
  const careerStats = showsCareerStats(rowsSource);
  const prIndexes = useMemo(
    () => (careerStats ? findPRIndexes(athleteResults) : NO_PR_INDEXES),
    [athleteResults, careerStats],
  );
  const partialStatus = partialResultsStatus({
    source: rowsSource,
    outcome: loadOutcome,
    isOffline,
  });

  // FlashList recycles cells, so it needs to be told when something outside
  // `data` changes what a row renders. Both of these do.
  const cardExtraData = useMemo(
    () => ({ prIndexes, colors }),
    [prIndexes, colors],
  );
  const renderResultCard = useCallback(
    ({ item, index }: { item: SupabaseLiftResult; index: number }) => (
      <MeetResultCard
        result={item}
        colors={colors}
        isSnatchPR={index === prIndexes.snatch}
        isCJPR={index === prIndexes.cj}
        isTotalPR={index === prIndexes.total}
        isFirst={index === 0}
      />
    ),
    [colors, prIndexes],
  );

  if (!name) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText>No athlete selected</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }, screenInsets]}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: name?.toString() || "Meet Results",
          headerBackTitle: "Back",
          headerTitleStyle: { color: colors.text },
          headerTintColor: colors.text,
          gestureEnabled: true,
          gestureDirection: "horizontal",
          animation: "slide_from_right",
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
        }}
      />

      {loading || athleteResults.length === 0 ? (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 20 },
          ]}
        >
          {loading ? (
            <View
              style={[
                styles.card,
                { backgroundColor: colors.card, marginTop: 16 },
              ]}
            >
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.secondaryText} />
              </View>
            </View>
          ) : (
            <View
              style={[
                styles.card,
                { backgroundColor: colors.card, marginTop: 16 },
              ]}
            >
              {loadFailed ? (
                <EmptyState
                  title={loadFailureCopy("results", isOffline).title}
                  message={loadFailureCopy("results", isOffline).message}
                  actionLabel="Retry"
                  onActionPress={() => setRetryCount((count) => count + 1)}
                />
              ) : (
                <View style={styles.emptyStateContainer}>
                  <ThemedText
                    style={[styles.emptyStateText, { color: colors.secondaryText }]}
                  >
                    No meet results found for{" "}
                    {name}
                  </ThemedText>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      ) : (
        <FlashList
          data={athleteResults}
          extraData={cardExtraData}
          keyExtractor={meetResultKey}
          renderItem={renderResultCard}
          ListHeaderComponent={
            <>
              {partialStatus ? (
                <View
                  style={styles.statusRow}
                  accessible
                  accessibilityLiveRegion="polite"
                  testID="athlete-results-partial-status"
                >
                  <ThemedText style={[styles.statusText, { color: colors.secondaryText }]}>
                    {partialStatus}
                  </ThemedText>
                  {loadOutcome === "offline-partial" ? (
                    <Pressable
                      onPress={retryLoad}
                      accessibilityRole="button"
                      accessibilityLabel="Retry loading the full history"
                      hitSlop={8}
                      testID="athlete-results-partial-retry"
                    >
                      <ThemedText style={[styles.statusText, styles.statusRetry, { color: colors.link }]}>
                        Retry
                      </ThemedText>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              {careerStats ? (
                <AthleteStats results={athleteResults} colors={colors} />
              ) : null}
            </>
          }
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: insets.bottom + 20,
          }}
        />
      )}
    </ThemedView>
  );
}

function AttemptDisplay({
  attempt,
  colors,
}: {
  attempt: number | null;
  colors: AppColors;
}) {
  if (attempt === null || attempt === 0) {
    return (
      <ThemedText style={[styles.attempt, { color: colors.secondaryText }]}>
        —
      </ThemedText>
    );
  }

  const isSuccess = attempt > 0;
  return (
    <ThemedText
      style={[
        styles.attempt,
        { color: isSuccess ? colors.success : colors.fail },
      ]}
    >
      {Math.abs(attempt)}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  card: {
    borderRadius: 12,
    marginBottom: 16,
    overflow: "hidden",
  },
  section: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  meetNameRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  meetName: {
    fontSize: 20,
    fontWeight: "600",
    flexShrink: 1,
  },
  prBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 8,
  },
  prBadgeText: {
    color: Palette.white,
    fontSize: 12,
    fontWeight: "700",
  },
  rateBarWrap: {
    marginBottom: 10,
  },
  meetDate: {
    fontSize: 15,
    marginBottom: 2,
  },
  weightClass: {
    fontSize: 15,
  },
  liftRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  liftName: {
    fontSize: 15,
    fontWeight: "500",
    flex: 1,
  },
  attempts: {
    flexDirection: "row",
    gap: 24,
    flex: 1,
    justifyContent: "flex-end",
  },
  attempt: {
    fontSize: 16,
    fontWeight: "600",
    minWidth: 50,
    textAlign: "center",
  },
  total: {
    fontSize: 20,
    fontWeight: "600",
    textAlign: "center",
  },
  statusRow: {
    paddingTop: 16,
    alignItems: "center",
  },
  statusText: {
    fontSize: 13,
    textAlign: "center",
  },
  statusRetry: {
    fontWeight: "600",
    marginTop: 4,
  },
  emptyStateContainer: {
    padding: 20,
    alignItems: "center",
  },
  emptyStateText: {
    fontSize: 15,
    textAlign: "center",
  },
  loadingContainer: {
    padding: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  statsGrid: {
    flexDirection: "row",
    padding: 12,
    gap: 12,
  },
  statsColumn: {
    flex: 1,
    paddingHorizontal: 4,
  },
  liftHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  statsValue: {
    fontSize: 20,
    fontWeight: "600",
    minWidth: 70,
    textAlign: "right",
  },
  attemptRatesContainer: {
    gap: 4,
  },
  attemptRateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  attemptRateLabel: {
    fontSize: 13,
    minWidth: 15,
  },
  attemptRateValue: {
    fontSize: 14,
    fontWeight: "500",
    minWidth: 45,
    textAlign: "center",
  },
  attemptRateSubtext: {
    fontSize: 13,
    minWidth: 45,
    textAlign: "right",
  },
  verticalDivider: {
    width: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
});
