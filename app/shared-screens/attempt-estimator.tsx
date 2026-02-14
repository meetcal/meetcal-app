import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { LiftResult } from "@/data/types/athletes";
import { useAppColors } from "@/hooks/useAppColors";
import {
  AthleteAttemptEstimate,
  calculateEstimates,
  generateAthleteNotes,
} from "@/lib/attempt-estimator";
import { supabase } from "@/lib/supabase";
import { Stack, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

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
      // Load session athletes
      const { data: athletesData, error: athletesError } = await supabase
        .from("athletes")
        .select("*")
        .eq("session_number", sessionNumber)
        .eq("session_platform", params.platform)
        .eq("meet", params.meet);

      if (athletesError) throw athletesError;

      const loadedAthletes: LiftResult[] = (athletesData || []).map(
        (athlete) => ({
          memberId: athlete.member_id || "",
          name: athlete.name,
          age: athlete.age,
          club: athlete.club,
          gender: athlete.gender || "",
          weightClass: athlete.weight_class || "",
          entryTotal: athlete.entry_total,
          adaptive: athlete.adaptive || false,
          session: {
            number: parseInt(params.sessionNumber),
            platform: params.platform as any,
          },
        }),
      );

      // Load all historical results for these athletes
      const athleteNames = loadedAthletes.map((a) => a.name);

      if (athleteNames.length > 0) {
        const { data: resultsData, error: resultsError } = await supabase
          .from("lifting_results")
          .select("*")
          .in("name", athleteNames);

        if (resultsError) throw resultsError;

        // Calculate estimates
        const calculatedEstimates = calculateEstimates(
          loadedAthletes,
          resultsData || [],
        );
        setEstimates(calculatedEstimates);
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
