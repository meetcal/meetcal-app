import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { SupabaseLiftResult } from "@/data/types/athletes";
import { MeetName } from "@/data/types/meet";
import { useAppColors } from "@/hooks/useAppColors";
import { filterSessionAthletes } from "@/lib/athletes";
import {
  AthleteAttemptEstimate,
  calculateEstimates,
  formatAttemptsOut,
  generateAthleteNotes,
  sortEstimatesByAttemptsOut,
} from "@/lib/attempt-estimator";
import {
  getAllCachedLiftingResultsForAthletes,
  getSessionAthletesFromMeetCache,
  saveSessionAthletes,
} from "@/lib/database/offline-store";
import {
  fetchAthletesWithSession,
  fetchRecentAthleteHistoryForNames,
} from "@/lib/database/queries";
import { isNetworkAvailable } from "@/lib/networkUtils";
import {
  ATTEMPT_HISTORY_YEARS,
  getHistoryCutoffDate,
} from "@/utils/dateTime";
import { Stack, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SubscriptionGate } from "@/components/ui/SubscriptionGate";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";
import { Palette } from "@/constants/Palette";

function SkeletonCard({ colors }: { colors: ReturnType<typeof useAppColors> }) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[styles.athleteCard, { backgroundColor: colors.card, opacity }]}
    >
      <View style={styles.athleteHeader}>
        <View style={[styles.skeletonLine, { width: "55%", backgroundColor: colors.border }]} />
        <View style={[styles.skeletonChevron, { backgroundColor: colors.border }]} />
      </View>
    </Animated.View>
  );
}

/**
 * A premium screen. The buttons that open it check the subscription, but a
 * `meetcal://` deep link reaches the route directly, so it gates itself like
 * every other premium screen.
 */
export default function AttemptEstimatorScreen() {
  return (
    <SubscriptionGate feature="attempt-estimator">
      <AttemptEstimatorContent />
    </SubscriptionGate>
  );
}

function AttemptEstimatorContent() {
  const screenInsets = useScreenHorizontalInsets();
  const colors = useAppColors();
  const params = useLocalSearchParams<{
    sessionNumber: string;
    platform: string;
    meet: string;
  }>();

  const sessionNumber = params.sessionNumber
    ? parseInt(params.sessionNumber)
    : NaN;
  const hasValidParams =
    !isNaN(sessionNumber) && !!params.platform && !!params.meet;

  const [estimates, setEstimates] = useState<AthleteAttemptEstimate[]>([]);
  // `loading` is the skeleton: true only until there is something to show.
  // Cached estimates paint straight away and the network refresh then runs
  // behind `refreshing`, so weak gym Wi-Fi no longer hides offline data
  // behind a skeleton until the request times out.
  const [loading, setLoading] = useState(hasValidParams);
  const [refreshing, setRefreshing] = useState(false);
  // Why the latest load could not refresh from the network: offline, or the
  // request failed. The error state when there is nothing to list, and a
  // note above the cached estimates otherwise.
  const [loadIssue, setLoadIssue] = useState<"offline" | "failed" | null>(null);
  const [expandedAthletes, setExpandedAthletes] = useState<Set<string>>(
    new Set(),
  );

  // The screen is reachable straight from a start list, so the user can move
  // between sessions while a load is still running. Without this guard the
  // previous session's estimates land in state after the new session's, and
  // the table shows session A's athletes under session B's header — the same
  // defect the start list carries a request id for.
  const requestIdRef = useRef(0);

  const loadData = useCallback(async () => {
    if (!hasValidParams) return;
    const requestId = ++requestIdRef.current;
    const isStale = () => requestId !== requestIdRef.current;
    setLoading(true);
    setRefreshing(false);
    setLoadIssue(null);
    setEstimates([]);
    try {
      const meetId = params.meet as MeetName;

      const hasNetwork = await isNetworkAvailable();
      if (isStale()) return;
      const cachedSessionAthletes = await getSessionAthletesFromMeetCache(
        meetId,
        sessionNumber,
        params.platform,
      );

      if (isStale()) return;

      const cutoffDate = getHistoryCutoffDate(ATTEMPT_HISTORY_YEARS);
      if (cachedSessionAthletes.length > 0) {
        const namedAthletes = cachedSessionAthletes.filter((athlete) =>
          athlete.name?.trim(),
        );
        // One pass over the cached meets for the whole session. Asking per
        // athlete re-inflated every cached meet's results blob once per
        // athlete — a 15-lifter session against three downloaded meets did
        // 45 decompressions instead of three. Per-athlete history blobs win
        // outright inside, so a downloaded meet's full history is used.
        const resultsByName = await getAllCachedLiftingResultsForAthletes(
          namedAthletes.map((athlete) => athlete.name),
        );
        const cachedSessionResults: SupabaseLiftResult[] = [];
        for (const athlete of namedAthletes) {
          const athleteResults = resultsByName[athlete.name] ?? [];
          cachedSessionResults.push(
            ...athleteResults.filter((r) => (r.date ?? "") >= cutoffDate),
          );
        }
        if (isStale()) return;
        setEstimates(
          calculateEstimates(cachedSessionAthletes, cachedSessionResults),
        );
        setLoading(false);
        if (hasNetwork) setRefreshing(true);
      }

      if (!hasNetwork) {
        setLoadIssue("offline");
        return;
      }

      // This session's rows only: the same request (and in-flight key) the
      // session screen that opens this one makes. It used to download the
      // whole roster (~457KB / 1,562 athletes at a national meet), then
      // re-read, merge and rewrite the roster cache, to keep one session.
      const freshSessionAthletes = filterSessionAthletes(
        await fetchAthletesWithSession(meetId, sessionNumber, params.platform),
        sessionNumber,
        params.platform,
      );
      if (isStale()) return;
      if (freshSessionAthletes.length === 0) {
        setEstimates([]);
        return;
      }
      // Off the critical path, as on the start list: a failed cache write
      // must not cost the user the estimates already in hand. An empty
      // answer (returned above) never overwrites a cached session.
      saveSessionAthletes(
        meetId,
        sessionNumber,
        params.platform,
        freshSessionAthletes,
      ).catch((error) => {
        console.warn("Failed to cache estimator session athletes:", error);
      });

      // History for *this session's* athletes only. This used to pull the
      // two-year history of the entire roster (~40 sequential requests at a
      // national meet) to render one session, then overwrite the meet's own
      // results blob with it.
      const freshSessionNames = Array.from(
        new Set(
          freshSessionAthletes
            .map((athlete) => athlete.name)
            .filter((name) => name?.trim()),
        ),
      );
      const freshSessionResults = await fetchRecentAthleteHistoryForNames(
        freshSessionNames,
        cutoffDate,
      );
      if (isStale()) return;
      setEstimates(calculateEstimates(freshSessionAthletes, freshSessionResults));
      // Not persisted: the per-athlete history keys are the explicit
      // download's complete record (and what marks a download as complete),
      // and they are never evicted. One session's two-year window is cheap to
      // refetch; offline, downloaded meets still cover it.
    } catch (error) {
      if (isStale()) return;
      console.error("Error loading data:", error);
      // Cached estimates already on screen stay there.
      setLoadIssue("failed");
    } finally {
      if (!isStale()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [hasValidParams, sessionNumber, params.platform, params.meet]);

  useEffect(() => {
    loadData();
    return () => {
      // Invalidate whatever is in flight: an unmount or a parameter change
      // must not repaint this screen with the old session's estimates.
      requestIdRef.current += 1;
    };
  }, [loadData]);

  const toggleAthlete = (athleteId: string) => {
    const newExpanded = new Set(expandedAthletes);
    if (newExpanded.has(athleteId)) {
      newExpanded.delete(athleteId);
    } else {
      newExpanded.add(athleteId);
    }
    setExpandedAthletes(newExpanded);
  };

  const sortedEstimates = sortEstimatesByAttemptsOut(estimates);

  if (!hasValidParams) {
    return (
      <ThemedView
        style={[styles.container, { backgroundColor: colors.background }, screenInsets]}
      >
        <Stack.Screen
          options={{
            headerShown: true,
            headerTitle: "Attempt Estimator",
            headerBackTitle: "Back",
            headerBackButtonDisplayMode: "minimal",
            headerTransparent: true,
            headerLargeTitle: false,
            headerStyle: { backgroundColor: colors.background },
            headerShadowVisible: false,
            headerTitleStyle: {
              color: colors.text,
            },
            headerTintColor: colors.text
          }}
        />
        <View style={styles.emptyContainer}>
          <ThemedText
            style={{ fontSize: 15, color: colors.secondaryText }}
          >
            Missing session information.
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (loading) {
    return (
      <ThemedView
        style={[styles.container, { backgroundColor: colors.background }, screenInsets]}
      >
        <Stack.Screen
          options={{
            headerShown: true,
            headerTitle: "Attempt Estimator",
            headerBackTitle: "Back",
            headerBackButtonDisplayMode: "minimal",
            headerStyle: { backgroundColor: colors.background },
            headerShadowVisible: false,
            headerTitleStyle: {
              color: colors.text,
            },
            headerTintColor: colors.text
          }}
        />
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <SkeletonCard key={i} colors={colors} />
          ))}
        </ScrollView>
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
          headerTitle: "Attempt Estimator",
          headerBackTitle: "Back",
          headerBackButtonDisplayMode: "minimal",
          headerTitleStyle: {
            color: colors.text,
          },
          headerTintColor: colors.text
        }}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {refreshing && (
          <View
            style={styles.statusRow}
            accessible
            accessibilityLiveRegion="polite"
            accessibilityLabel="Refreshing estimates"
          >
            <ActivityIndicator size="small" color={colors.secondaryText} />
            <ThemedText style={[styles.statusText, { color: colors.secondaryText }]}>
              Refreshing…
            </ThemedText>
          </View>
        )}
        {!refreshing && loadIssue && sortedEstimates.length > 0 && (
          <View style={styles.statusRow} accessible accessibilityLiveRegion="polite">
            <ThemedText style={[styles.statusText, { color: colors.secondaryText }]}>
              {loadIssue === "offline"
                ? "Offline. Showing downloaded data."
                : "Couldn't refresh. Showing downloaded data."}
            </ThemedText>
          </View>
        )}
        <View
          style={[
            styles.disclaimerCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <ThemedText
            style={[styles.disclaimerText, { color: colors.secondaryText }]}
          >
            This data is based on historical meet results and may be inaccurate
            if the session includes athletes at their first meet. Always refer
            to the board for the final count.
          </ThemedText>
        </View>

        {sortedEstimates.length === 0 && (
          <View style={styles.messageContainer}>
            <ThemedText style={[styles.messageTitle, { color: colors.text }]}>
              {loadIssue === "offline"
                ? "You're offline"
                : loadIssue === "failed"
                  ? "Couldn't load estimates"
                  : "No athletes in this session"}
            </ThemedText>
            <ThemedText
              style={[styles.messageText, { color: colors.secondaryText }]}
            >
              {loadIssue === "offline"
                ? "This session isn't downloaded. Connect to the internet and try again."
                : loadIssue === "failed"
                  ? "Check your connection and try again."
                  : "The start list has no athletes for this session and platform yet."}
            </ThemedText>
            <Pressable
              style={({ pressed }) => [
                styles.retryButton,
                { backgroundColor: colors.link },
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => {
                void loadData();
              }}
              accessibilityRole="button"
              accessibilityLabel="Retry loading estimates"
            >
              <ThemedText style={styles.retryButtonText}>Retry</ThemedText>
            </Pressable>
          </View>
        )}

        {sortedEstimates.map((estimate) => (
          <View
            key={estimate.id}
            style={[styles.athleteCard, { backgroundColor: colors.card }]}
          >
            <Pressable
              style={styles.athleteHeader}
              onPress={() => toggleAthlete(estimate.id)}
              accessibilityRole="button"
              accessibilityState={{ expanded: expandedAthletes.has(estimate.id) }}
              accessibilityHint="Shows the estimated attempts and notes"
            >
              <View style={styles.athleteHeaderText}>
                <ThemedText style={styles.athleteName}>
                  {estimate.athleteName}
                </ThemedText>
                <ThemedText
                  style={[styles.athleteSubtitle, { color: colors.secondaryText }]}
                >
                  {`Snatch: ${formatAttemptsOut(estimate.snatchAttemptsOut)}`}
                </ThemedText>
              </View>
              <IconSymbol
                name={
                  expandedAthletes.has(estimate.id)
                    ? "chevron.down"
                    : "chevron.right"
                }
                size={16}
                color={colors.secondaryText}
              />
            </Pressable>

            {expandedAthletes.has(estimate.id) && (
              <View
                style={[
                  styles.athleteDetails,
                  { borderTopColor: colors.border },
                ]}
              >
                <View style={styles.section}>
                  <ThemedText style={styles.sectionTitle}>
                    Estimated Count
                  </ThemedText>

                  {estimate.snatchAttemptsOut !== null ? (
                    <ThemedText
                      style={[
                        styles.detailText,
                        { color: colors.secondaryText },
                      ]}
                    >
                      {`Snatch: ${formatAttemptsOut(estimate.snatchAttemptsOut)}`}
                    </ThemedText>
                  ) : (
                    <ThemedText
                      style={[
                        styles.detailText,
                        { color: colors.secondaryText },
                      ]}
                    >
                      Snatch: No data available
                    </ThemedText>
                  )}

                  {estimate.cjAttemptsOut !== null ? (
                    <ThemedText
                      style={[
                        styles.detailText,
                        { color: colors.secondaryText },
                      ]}
                    >
                      {`CJ: ${formatAttemptsOut(estimate.cjAttemptsOut)}`}
                    </ThemedText>
                  ) : (
                    <ThemedText
                      style={[
                        styles.detailText,
                        { color: colors.secondaryText },
                      ]}
                    >
                      CJ: No data available
                    </ThemedText>
                  )}
                </View>

                <View
                  style={[styles.divider, { backgroundColor: colors.border }]}
                />

                <View style={styles.section}>
                  <ThemedText style={styles.sectionTitle}>
                    Estimated Attempts
                  </ThemedText>

                  <View style={styles.table}>
                    <View style={styles.tableRow}>
                      <ThemedText
                        style={[styles.tableHeader, styles.tableCell]}
                      ></ThemedText>
                      <ThemedText
                        style={[styles.tableHeader, styles.tableCell]}
                      >
                        1
                      </ThemedText>
                      <ThemedText
                        style={[styles.tableHeader, styles.tableCell]}
                      >
                        2
                      </ThemedText>
                      <ThemedText
                        style={[styles.tableHeader, styles.tableCell]}
                      >
                        3
                      </ThemedText>
                    </View>

                    <View
                      style={[
                        styles.tableDivider,
                        { backgroundColor: colors.border },
                      ]}
                    />

                    {estimate.snatchEstimates.length > 0 &&
                      estimate.snatchEstimates[0] > 0 && (
                        <>
                          <View style={styles.tableRow}>
                            <ThemedText
                              style={[styles.tableHeader, styles.tableCell]}
                            >
                              Snatch
                            </ThemedText>
                            <ThemedText
                              style={[
                                styles.tableCellText,
                                { color: colors.secondaryText },
                              ]}
                            >
                              {estimate.snatchEstimates[0] ?? "—"}
                            </ThemedText>
                            <ThemedText
                              style={[
                                styles.tableCellText,
                                { color: colors.secondaryText },
                              ]}
                            >
                              {estimate.snatchEstimates.length > 1
                                ? estimate.snatchEstimates[1]
                                : "—"}
                            </ThemedText>
                            <ThemedText
                              style={[
                                styles.tableCellText,
                                { color: colors.secondaryText },
                              ]}
                            >
                              {estimate.snatchEstimates.length > 2
                                ? estimate.snatchEstimates[2]
                                : "—"}
                            </ThemedText>
                          </View>
                          <View
                            style={[
                              styles.tableDivider,
                              { backgroundColor: colors.border },
                            ]}
                          />
                        </>
                      )}

                    {estimate.cjEstimates.length > 0 &&
                      estimate.cjEstimates[0] > 0 && (
                        <View style={styles.tableRow}>
                          <ThemedText
                            style={[styles.tableHeader, styles.tableCell]}
                          >
                            CJ
                          </ThemedText>
                          <ThemedText
                            style={[
                              styles.tableCellText,
                              { color: colors.secondaryText },
                            ]}
                          >
                            {estimate.cjEstimates[0] ?? "—"}
                          </ThemedText>
                          <ThemedText
                            style={[
                              styles.tableCellText,
                              { color: colors.secondaryText },
                            ]}
                          >
                            {estimate.cjEstimates.length > 1
                              ? estimate.cjEstimates[1]
                              : "—"}
                          </ThemedText>
                          <ThemedText
                            style={[
                              styles.tableCellText,
                              { color: colors.secondaryText },
                            ]}
                          >
                            {estimate.cjEstimates.length > 2
                              ? estimate.cjEstimates[2]
                              : "—"}
                          </ThemedText>
                        </View>
                      )}
                  </View>
                </View>

                <View
                  style={[styles.divider, { backgroundColor: colors.border }]}
                />

                <View style={styles.section}>
                  <ThemedText style={styles.sectionTitle}>
                    Athlete Notes
                  </ThemedText>
                  <ThemedText
                    style={[styles.detailText, { color: colors.secondaryText }]}
                  >
                    {generateAthleteNotes(estimate)}
                  </ThemedText>
                </View>
              </View>
            )}
          </View>
        ))}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingTop: 16,
  },
  disclaimerCard: {
    padding: 16,
    borderRadius: 10,
    marginBottom: 16,
    borderWidth: 1,
  },
  disclaimerText: {
    fontSize: 14,
    fontStyle: "italic",
    textAlign: "center",
    lineHeight: 20,
  },
  athleteCard: {
    borderRadius: 10,
    marginBottom: 12,
    overflow: "hidden",
  },
  athleteHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
  },
  athleteHeaderText: {
    flex: 1,
    marginRight: 12,
  },
  athleteName: {
    fontSize: 14,
    fontWeight: "600",
  },
  athleteSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 12,
  },
  statusText: {
    fontSize: 13,
  },
  messageContainer: {
    alignItems: "center",
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  messageTitle: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 8,
    textAlign: "center",
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 16,
  },
  retryButton: {
    minHeight: 44,
    minWidth: 120,
    paddingHorizontal: 24,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  retryButtonText: {
    color: Palette.white,
    fontSize: 16,
    fontWeight: "600",
  },
  athleteDetails: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  section: {
    paddingVertical: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 8,
  },
  detailText: {
    fontSize: 15,
    lineHeight: 20,
    marginTop: 4,
  },
  divider: {
    height: 1,
    marginVertical: 8,
  },
  table: {
    marginTop: 8,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 8,
  },
  tableCell: {
    flex: 1,
    textAlign: "center",
  },
  tableHeader: {
    fontWeight: "600",
    fontSize: 15,
  },
  tableCellText: {
    flex: 1,
    textAlign: "center",
    fontSize: 15,
  },
  tableDivider: {
    height: 1,
    marginVertical: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  skeletonLine: {
    height: 14,
    borderRadius: 7,
  },
  skeletonChevron: {
    width: 16,
    height: 16,
    borderRadius: 4,
  },
});
