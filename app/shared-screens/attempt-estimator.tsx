import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { LiftResult, SupabaseLiftResult } from "@/data/types/athletes";
import { MeetName } from "@/data/types/meet";
import { useAppColors } from "@/hooks/useAppColors";
import {
  AthleteAttemptEstimate,
  calculateEstimates,
  generateAthleteNotes,
} from "@/lib/attempt-estimator";
import {
  getMeetLiftingResults,
  getSessionAthletesFromMeetCache,
  saveMeetAthletes,
  saveMeetLiftingResults,
} from "@/lib/database/offline-store";
import {
  fetchAthletesWithSession,
  fetchLiftingResultsForMeet,
} from "@/lib/database/queries";
import { isNetworkAvailable } from "@/lib/networkUtils";
import { Stack, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

function normalizePlatformKey(value: string) {
  return value.trim().toLowerCase();
}

function normalizeAthleteName(name: string | null | undefined) {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function filterSessionAthletes(
  athletes: LiftResult[],
  sessionNumber: number,
  platform: string,
) {
  const normalizedPlatform = normalizePlatformKey(platform);
  return athletes.filter((athlete) => {
    const athleteSession = athlete.session;
    if (!athleteSession) return false;
    if (athleteSession.number !== sessionNumber) return false;
    return normalizePlatformKey(athleteSession.platform) === normalizedPlatform;
  });
}

export default function AttemptEstimatorScreen() {
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
  const [loading, setLoading] = useState(hasValidParams);
  const [expandedAthletes, setExpandedAthletes] = useState<Set<string>>(
    new Set(),
  );

  const loadData = useCallback(async () => {
    if (!hasValidParams) return;
    setLoading(true);
    try {
      const meetId = params.meet as MeetName;

      const cachedSessionAthletes = await getSessionAthletesFromMeetCache(
        meetId,
        sessionNumber,
        params.platform,
      );
      const cachedMeetResults = await getMeetLiftingResults(meetId);

      if (cachedSessionAthletes.length > 0) {
        const athleteNameSet = new Set(
          cachedSessionAthletes.map((athlete) => normalizeAthleteName(athlete.name)),
        );
        const cachedSessionResults = cachedMeetResults.filter((result) =>
          athleteNameSet.has(normalizeAthleteName(result.name)),
        );
        setEstimates(
          calculateEstimates(cachedSessionAthletes, cachedSessionResults),
        );
      } else {
        setEstimates([]);
      }

      const hasNetwork = await isNetworkAvailable();
      if (!hasNetwork) {
        return;
      }

      const freshMeetAthletes = await fetchAthletesWithSession(meetId);
      await saveMeetAthletes(meetId, freshMeetAthletes);

      const freshSessionAthletes = filterSessionAthletes(
        freshMeetAthletes,
        sessionNumber,
        params.platform,
      );
      const freshSessionNameSet = new Set(
        freshSessionAthletes.map((athlete) => normalizeAthleteName(athlete.name)),
      );
      const freshAllNames = Array.from(
        new Set(freshMeetAthletes.map((athlete) => athlete.name)),
      );

      let freshResults: SupabaseLiftResult[] = [];
      if (freshAllNames.length > 0) {
        freshResults = await fetchLiftingResultsForMeet(meetId, freshAllNames);
      }
      await saveMeetLiftingResults(meetId, freshResults);

      const freshSessionResults = freshResults.filter((result) =>
        freshSessionNameSet.has(normalizeAthleteName(result.name)),
      );

      if (freshSessionAthletes.length > 0) {
        setEstimates(
          calculateEstimates(freshSessionAthletes, freshSessionResults),
        );
      } else {
        setEstimates([]);
      }
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  }, [hasValidParams, sessionNumber, params.platform, params.meet]);

  useEffect(() => {
    loadData();
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

  const sortedEstimates = [...estimates].sort(
    (a, b) => a.snatchAttemptsOut - b.snatchAttemptsOut,
  );

  if (!hasValidParams) {
    return (
      <ThemedView
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <Stack.Screen
          options={{
            headerShown: true,
            headerTitle: "Attempt Estimator",
            headerBackTitle: "Back",
            headerBackButtonDisplayMode: "minimal",
          }}
        />
        <View style={styles.loadingContainer}>
          <ThemedText
            style={[styles.loadingText, { color: colors.secondaryText }]}
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
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <Stack.Screen
          options={{
            headerShown: true,
            headerTitle: "Attempt Estimator",
            headerBackTitle: "Back",
            headerBackButtonDisplayMode: "minimal",
          }}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.secondaryText} />
          <ThemedText
            style={[styles.loadingText, { color: colors.secondaryText }]}
          >
            Loading estimates...
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: "Attempt Estimator",
          headerBackTitle: "Back",
          headerBackButtonDisplayMode: "minimal",
        }}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
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

        {sortedEstimates.map((estimate) => (
          <View
            key={estimate.id}
            style={[styles.athleteCard, { backgroundColor: colors.card }]}
          >
            <Pressable
              style={styles.athleteHeader}
              onPress={() => toggleAthlete(estimate.id)}
            >
              <ThemedText style={styles.athleteName}>
                {estimate.athleteName}
              </ThemedText>
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

                  {estimate.snatchEstimates.length > 0 &&
                  estimate.snatchEstimates[0] > 0 ? (
                    <ThemedText
                      style={[
                        styles.detailText,
                        { color: colors.secondaryText },
                      ]}
                    >
                      Snatch: 
{' '}
{estimate.snatchAttemptsOut}
{' '}
attempts out
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

                  {estimate.cjEstimates.length > 0 &&
                  estimate.cjEstimates[0] > 0 ? (
                    <ThemedText
                      style={[
                        styles.detailText,
                        { color: colors.secondaryText },
                      ]}
                    >
                      CJ: 
{' '}
{estimate.cjAttemptsOut}
{' '}
attempts out
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
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
  },
  loadingText: {
    fontSize: 15,
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
  athleteName: {
    fontSize: 17,
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
});
