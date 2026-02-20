import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { resolveAthleteResultsMeetScope } from "@/app/shared-screens/athlete-results-scope";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { useAppColors } from "@/hooks/useAppColors";
import { getAthleteLiftingResults } from "@/lib/database/offline-store";
import { supabase } from "@/lib/supabase";
import { SupabaseLiftResult } from "@/types/athlete-results";
import { Stack, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";


function AthleteStats({
  results,
  colors,
}: {
  results: SupabaseLiftResult[];
  colors: any;
}) {
  const stats = useMemo(() => {
    let snatchAttempts = 0;
    let snatchMakes = 0;
    let cjAttempts = 0;
    let cjMakes = 0;

    // Initialize attempt-specific counters
    const snatchAttemptsByNumber = {
      attempt1: { makes: 0, total: 0 },
      attempt2: { makes: 0, total: 0 },
      attempt3: { makes: 0, total: 0 },
    };

    const cjAttemptsByNumber = {
      attempt1: { makes: 0, total: 0 },
      attempt2: { makes: 0, total: 0 },
      attempt3: { makes: 0, total: 0 },
    };

    results.forEach((result) => {
      // Count snatch attempts
      [result.snatch1, result.snatch2, result.snatch3].forEach(
        (attempt, index) => {
          if (attempt !== null && attempt !== 0) {
            snatchAttempts++;
            if (attempt > 0) snatchMakes++;

            // Count attempt-specific stats
            const attemptKey =
              `attempt${index + 1}` as keyof typeof snatchAttemptsByNumber;
            snatchAttemptsByNumber[attemptKey].total++;
            if (attempt > 0) snatchAttemptsByNumber[attemptKey].makes++;
          }
        },
      );

      // Count clean & jerk attempts
      [result.cj1, result.cj2, result.cj3].forEach((attempt, index) => {
        if (attempt !== null && attempt !== 0) {
          cjAttempts++;
          if (attempt > 0) cjMakes++;

          // Count attempt-specific stats
          const attemptKey =
            `attempt${index + 1}` as keyof typeof cjAttemptsByNumber;
          cjAttemptsByNumber[attemptKey].total++;
          if (attempt > 0) cjAttemptsByNumber[attemptKey].makes++;
        }
      });
    });

    // Calculate rates for each attempt
    const calculateRates = (attempts: typeof snatchAttemptsByNumber) => {
      return {
        attempt1: {
          ...attempts.attempt1,
          rate:
            attempts.attempt1.total > 0
              ? (attempts.attempt1.makes / attempts.attempt1.total) * 100
              : 0,
        },
        attempt2: {
          ...attempts.attempt2,
          rate:
            attempts.attempt2.total > 0
              ? (attempts.attempt2.makes / attempts.attempt2.total) * 100
              : 0,
        },
        attempt3: {
          ...attempts.attempt3,
          rate:
            attempts.attempt3.total > 0
              ? (attempts.attempt3.makes / attempts.attempt3.total) * 100
              : 0,
        },
      };
    };

    return {
      snatchMakeRate:
        snatchAttempts > 0 ? (snatchMakes / snatchAttempts) * 100 : 0,
      cjMakeRate: cjAttempts > 0 ? (cjMakes / cjAttempts) * 100 : 0,
      totalSnatchAttempts: snatchAttempts,
      totalCJAttempts: cjAttempts,
      snatchAttemptRates: calculateRates(snatchAttemptsByNumber),
      cjAttemptRates: calculateRates(cjAttemptsByNumber),
    };
  }, [results]);

  const getRateColor = (rate: number) => {
    if (rate >= 80) return colors.success;
    if (rate < 70) return colors.fail;
    return "#FF9500"; // Amber color
  };

  const AttemptRateRow = ({
    attemptNumber,
    rates,
    colors,
  }: {
    attemptNumber: number;
    rates: { makes: number; total: number; rate: number };
    colors: any;
  }) => (
    <View style={styles.attemptRateRow}>
      <ThemedText
        style={[styles.attemptRateLabel, { color: colors.secondaryText }]}
      >
        {attemptNumber}
      </ThemedText>
      <ThemedText
        style={[styles.attemptRateValue, { color: getRateColor(rates.rate) }]}
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

  return (
    <View
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
                { color: getRateColor(stats.snatchMakeRate) },
              ]}
            >
              {stats.snatchMakeRate.toFixed(1)}
%
</ThemedText>
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
                { color: getRateColor(stats.cjMakeRate) },
              ]}
            >
              {stats.cjMakeRate.toFixed(1)}
%
</ThemedText>
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
    </View>
  );
}

export default function AthleteResultsScreen() {
  const colors = useAppColors();
  const { name, meet } = useLocalSearchParams<{ name?: string; meet?: string }>();
  const { selectedMeet } = useSelectedMeet();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [athleteResults, setAthleteResults] = useState<SupabaseLiftResult[]>(
    [],
  );
  const resultsCacheRef = useRef<Map<string, SupabaseLiftResult[]>>(new Map());
  const requestIdRef = useRef(0);

  // Add useEffect to fetch data from cache first, then Supabase
  useEffect(() => {
    const fetchAthleteResults = async () => {
      if (!name) return;

      const nameStr = Array.isArray(name) ? name[0] : name;
      const meetScope = resolveAthleteResultsMeetScope(meet, selectedMeet);
      const cacheKey = `${meetScope || "all"}::${nameStr}`;
      const cachedResults = resultsCacheRef.current.get(cacheKey);
      if (cachedResults) {
        setAthleteResults(cachedResults);
        setLoading(false);
      } else {
        setLoading(true);
      }

      const requestId = ++requestIdRef.current;
      try {
        let results: SupabaseLiftResult[] = [];

        // Try to get from cache first if we have a meet scope
        if (meetScope) {
          try {
            const offlineResults = await getAthleteLiftingResults(
              meetScope,
              nameStr,
            );
            if (offlineResults && offlineResults.length > 0) {
              results = offlineResults;
            }
          } catch (cacheError) {
            console.log(
              `Cache miss for athlete results, fetching from Supabase ${cacheError}`,
            );
          }
        }

        // If no cached results, fetch from Supabase
        if (results.length === 0) {
          const { data, error } = await supabase
            .from("lifting_results")
            .select(
              "id,event_id,meet,date,name,age,body_weight,snatch1,snatch2,snatch3,snatch_best,cj1,cj2,cj3,cj_best,total",
            )
            .eq("name", nameStr)
            .order("date", { ascending: false });

          if (error) {
            console.error("Error fetching athlete results:", error);
            return;
          }

          results = data || [];
        }

        if (requestId !== requestIdRef.current) return;
        resultsCacheRef.current.set(cacheKey, results);
        setAthleteResults(results);
      } catch (error) {
        console.error("Error in fetchAthleteResults:", error);
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    };

    fetchAthleteResults();
  }, [name, meet, selectedMeet]);

  if (!name) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText>No athlete selected</ThemedText>
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
        ) : athleteResults.length === 0 ? (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.card, marginTop: 16 },
            ]}
          >
            <View style={styles.emptyStateContainer}>
              <ThemedText
                style={[styles.emptyStateText, { color: colors.secondaryText }]}
              >
                No meet results found for 
{' '}
{name}
              </ThemedText>
            </View>
          </View>
        ) : (
          <>
            <AthleteStats results={athleteResults} colors={colors} />
            {athleteResults.map((result, index) => (
              <View
                key={result.id}
                style={[
                  styles.card,
                  { backgroundColor: colors.card },
                  index === 0 && { marginTop: 16 },
                ]}
              >
                <View
                  style={[styles.section, { borderBottomColor: colors.border }]}
                >
                  <ThemedText style={styles.meetName}>{result.meet}</ThemedText>
                  <ThemedText
                    style={[styles.meetDate, { color: colors.secondaryText }]}
                  >
                    Date: 
{' '}
{new Date(result.date).toLocaleDateString()}
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.weightClass,
                      { color: colors.secondaryText },
                    ]}
                  >
                    {result.age}
                  </ThemedText>
                </View>

                <View
                  style={[styles.section, { borderBottomColor: colors.border }]}
                >
                  <View style={styles.liftRow}>
                    <ThemedText
                      style={[styles.liftName, { color: colors.secondaryText }]}
                    >
                      Snatch
                    </ThemedText>
                    <View style={styles.attempts}>
                      <AttemptDisplay
                        attempt={result.snatch1}
                        colors={colors}
                      />
                      <AttemptDisplay
                        attempt={result.snatch2}
                        colors={colors}
                      />
                      <AttemptDisplay
                        attempt={result.snatch3}
                        colors={colors}
                      />
                    </View>
                  </View>
                </View>

                <View
                  style={[styles.section, { borderBottomColor: colors.border }]}
                >
                  <View style={styles.liftRow}>
                    <ThemedText
                      style={[styles.liftName, { color: colors.secondaryText }]}
                    >
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
                    {result.snatch_best ?? "—"}
/
{result.cj_best ?? "—"}
/
{result.total ?? "—"}
                  </ThemedText>
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

function AttemptDisplay({
  attempt,
  colors,
}: {
  attempt: number | null;
  colors: any;
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
  meetName: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 4,
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
