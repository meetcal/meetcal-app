import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { useAppColors } from "@/hooks/useAppColors";
import { convex } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import { LiftingResult, WrappedStats } from "@/types/wrapped";
import { Stack } from "expo-router";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  useWindowDimensions,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const YEARS = Array.from(
  { length: 10 },
  (_, i) => new Date().getFullYear() - i,
);

export default function WeightliftingWrappedScreen() {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [loading, setLoading] = useState(false);
  const [, setResults] = useState<LiftingResult[]>([]);
  const [wrappedStats, setWrappedStats] = useState<WrappedStats | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [, setCurrentSlide] = useState(0);

  // Animation refs
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(screenWidth)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  const searchAthlete = async () => {
    if (!searchQuery.trim()) {
      Alert.alert("Error", "Please enter an athlete name");
      return;
    }

    setLoading(true);
    try {
      const normalizedName = searchQuery.trim();
      const startDate = `${selectedYear}-01-01`;
      const endDate = `${selectedYear + 1}-01-01`;

      // Exact name lookup first
      let rows = await convex.query(api.liftingResults.getByNames, { names: [normalizedName] });
      let data: LiftingResult[] = rows
        .filter((r: any) => r.date >= startDate && r.date < endDate)
        .map((r: any): LiftingResult => ({
          id: r._id,
          event_id: r.eventId,
          meet: r.meet,
          date: r.date,
          name: r.name,
          age: r.age,
          body_weight: r.bodyWeight,
          snatch1: r.snatch1,
          snatch2: r.snatch2,
          snatch3: r.snatch3,
          snatch_best: r.snatchBest,
          cj1: r.cj1,
          cj2: r.cj2,
          cj3: r.cj3,
          cj_best: r.cjBest,
          total: r.total,
        }))
        .sort((a: LiftingResult, b: LiftingResult) => a.date.localeCompare(b.date))
        .slice(0, 600);

      // Fallback: partial name search
      if (data.length === 0) {
        const searchRows = await convex.query(api.liftingResults.searchByNameAndYear, {
          query: normalizedName,
          startDate,
          endDate,
        });
        data = searchRows.slice(0, 600).map((r: any): LiftingResult => ({
          id: r._id,
          event_id: r.eventId,
          meet: r.meet,
          date: r.date,
          name: r.name,
          age: r.age,
          body_weight: r.bodyWeight,
          snatch1: r.snatch1,
          snatch2: r.snatch2,
          snatch3: r.snatch3,
          snatch_best: r.snatchBest,
          cj1: r.cj1,
          cj2: r.cj2,
          cj3: r.cj3,
          cj_best: r.cjBest,
          total: r.total,
        }));
      }

      if (!data || data.length === 0) {
        Alert.alert(
          "No Results",
          `No results found for ${searchQuery} in ${selectedYear}`,
        );
        return;
      }

      setResults(data);
      const stats = calculateWrappedStats(data);
      setWrappedStats(stats);
      setShowStats(true);
      setCurrentSlide(0);
      startAnimation();
    } catch (error) {
      console.error("Error in searchAthlete:", error);
      Alert.alert("Error", "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const calculateWrappedStats = (data: LiftingResult[]): WrappedStats => {
    let totalWeight = 0;
    let totalAttempts = 0;
    let successfulAttempts = 0;
    let bestSnatch = 0;
    let bestCJ = 0;
    let bestTotal = 0;
    let totalSum = 0;
    let validTotals = 0;
    let consecutiveMakes = 0;
    let maxConsecutiveMakes = 0;

    const meetTotals: { [key: string]: number } = {};

    data.forEach((result) => {
      // Calculate total weight lifted (sum of all successful attempts)
      [
        result.snatch1,
        result.snatch2,
        result.snatch3,
        result.cj1,
        result.cj2,
        result.cj3,
      ].forEach((attempt) => {
        if (attempt && attempt > 0) {
          totalWeight += attempt;
          successfulAttempts++;
          consecutiveMakes++;
          maxConsecutiveMakes = Math.max(maxConsecutiveMakes, consecutiveMakes);
        } else if (attempt !== null && attempt !== 0) {
          totalAttempts++;
          consecutiveMakes = 0;
        }
        if (attempt !== null && attempt !== 0) totalAttempts++;
      });

      // Track bests
      if (result.snatch_best)
        bestSnatch = Math.max(bestSnatch, result.snatch_best);
      if (result.cj_best) bestCJ = Math.max(bestCJ, result.cj_best);
      if (result.total) {
        bestTotal = Math.max(bestTotal, result.total);
        totalSum += result.total;
        validTotals++;
        meetTotals[result.meet] = Math.max(
          meetTotals[result.meet] || 0,
          result.total,
        );
      }
    });

    const makePercentage =
      totalAttempts > 0 ? (successfulAttempts / totalAttempts) * 100 : 0;
    const averageTotal = validTotals > 0 ? totalSum / validTotals : 0;

    // Find top meet
    const topMeet = Object.keys(meetTotals).reduce(
      (a, b) => (meetTotals[a] > meetTotals[b] ? a : b),
      Object.keys(meetTotals)[0] || "N/A",
    );

    // Calculate improvement
    const firstTotal = data[0]?.total || 0;
    const lastTotal = data[data.length - 1]?.total || 0;
    const improvement = lastTotal - firstTotal;

    // Determine favorite attempt (most successful)
    const attemptCounts = { "1st": 0, "2nd": 0, "3rd": 0 };
    data.forEach((result) => {
      if (result.snatch1 && result.snatch1 > 0) attemptCounts["1st"]++;
      if (result.snatch2 && result.snatch2 > 0) attemptCounts["2nd"]++;
      if (result.snatch3 && result.snatch3 > 0) attemptCounts["3rd"]++;
      if (result.cj1 && result.cj1 > 0) attemptCounts["1st"]++;
      if (result.cj2 && result.cj2 > 0) attemptCounts["2nd"]++;
      if (result.cj3 && result.cj3 > 0) attemptCounts["3rd"]++;
    });

    const favoriteAttempt = Object.keys(attemptCounts).reduce((a, b) =>
      attemptCounts[a as keyof typeof attemptCounts] >
      attemptCounts[b as keyof typeof attemptCounts]
        ? a
        : b,
    );

    // Calculate rank (simplified)
    let yearRank = "Rising Star";
    if (makePercentage >= 90) yearRank = "Consistency King";
    else if (bestTotal >= 300) yearRank = "Heavy Hitter";
    else if (data.length >= 5) yearRank = "Meet Regular";

    return {
      totalWeightLifted: totalWeight,
      totalMeets: new Set(data.map((r) => r.meet)).size,
      makePercentage,
      bestSnatch,
      bestCleanJerk: bestCJ,
      bestTotal,
      averageTotal,
      topMeet,
      improvementFromFirst: improvement,
      consecutiveMakes: maxConsecutiveMakes,
      favoriteAttempt,
      yearRank,
    };
  };

  const startAnimation = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const shareWrapped = async () => {
    try {
      if (!wrappedStats) return;

      const shareText = `🏋️‍♂️ My ${selectedYear} Weightlifting Wrapped! 

📊 Total Weight Lifted: ${wrappedStats.totalWeightLifted.toLocaleString()}kg
🎯 Make Percentage: ${wrappedStats.makePercentage.toFixed(1)}%
🏆 Best Total: ${wrappedStats.bestTotal}kg
🔥 Snatch PR: ${wrappedStats.bestSnatch}kg
💪 Clean & Jerk PR: ${wrappedStats.bestCleanJerk}kg
🥇 Competed in ${wrappedStats.totalMeets} meets
⭐ Status: ${wrappedStats.yearRank}

#WeightliftingWrapped #Powerlifting #Training`;

      await Share.share({
        message: shareText,
      });
    } catch (error) {
      console.error("Error sharing wrapped:", error);
      Alert.alert("Error", "Failed to share wrapped");
    }
  };

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Stack.Screen
        options={{
          headerTitle: "Weightlifting Wrapped",
          headerTitleStyle: { color: colors.text },
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerTintColor: colors.text,
        }}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 20 },
        ]}
      >
        {/* Search Section */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <ThemedText style={[styles.cardTitle, { color: colors.text }]}>
            Find Your Wrapped
          </ThemedText>

          <View style={styles.inputContainer}>
            <TextInput
              style={[
                styles.searchInput,
                {
                  backgroundColor: colors.background,
                  color: colors.text,
                  borderColor: colors.border,
                },
              ]}
              placeholder="Enter athlete name"
              placeholderTextColor={colors.secondaryText}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.yearSelector}>
            <ThemedText
              style={[styles.yearLabel, { color: colors.secondaryText }]}
            >
              Year
            </ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {YEARS.map((year) => (
                <Pressable
                  key={year}
                  style={[
                    styles.yearChip,
                    {
                      backgroundColor:
                        selectedYear === year
                          ? colors.wrappedPrimary
                          : colors.background,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => setSelectedYear(year)}
                >
                  <ThemedText
                    style={[
                      styles.yearChipText,
                      {
                        color: selectedYear === year ? "#FFFFFF" : colors.text,
                      },
                    ]}
                  >
                    {year}
                  </ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          <Pressable
            style={[
              styles.searchButton,
              { backgroundColor: colors.wrappedPrimary },
            ]}
            onPress={searchAthlete}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <ThemedText style={styles.searchButtonText}>
                Generate Wrapped
              </ThemedText>
            )}
          </Pressable>
        </View>

        {/* Stats Cards or Info Section */}
        {showStats && wrappedStats ? (
          <>
            {/* Year Overview Card */}
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <ThemedText style={[styles.cardTitle, { color: colors.text }]}>
                Your 
{' '}
{selectedYear}
{' '}
Weightlifting Year
</ThemedText>
              <View style={styles.yearOverview}>
                <ThemedText
                  style={[styles.athleteName, { color: colors.text }]}
                >
                  {searchQuery}
                </ThemedText>
                <ThemedText
                  style={[styles.yearRank, { color: colors.wrappedPrimary }]}
                >
                  {wrappedStats.yearRank}
                </ThemedText>
                <ThemedText
                  style={[styles.overview, { color: colors.secondaryText }]}
                >
                  {wrappedStats.totalMeets}
{' '}
meets •
{" "}
                  {wrappedStats.makePercentage.toFixed(0)}
% success rate
</ThemedText>
              </View>
            </View>

            {/* Total Weight Card */}
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <ThemedText style={[styles.cardTitle, { color: colors.text }]}>
                Total Weight Lifted
              </ThemedText>
              <View style={styles.statContainer}>
                <ThemedText
                  style={[
                    styles.bigStatNumber,
                    { color: colors.wrappedAccent },
                  ]}
                >
                  {wrappedStats.totalWeightLifted
                    .toString()
                    .replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
                </ThemedText>
                <ThemedText style={[styles.statUnit, { color: colors.text }]}>
                  kg
                </ThemedText>
              </View>
              <ThemedText
                style={[
                  styles.statDescription,
                  { color: colors.secondaryText },
                ]}
              >
                That&apos;s equivalent to lifting
{" "}
                {Math.round(wrappedStats.totalWeightLifted / 180)}
{' '}
people!
</ThemedText>
            </View>

            {/* Personal Records Card */}
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <ThemedText style={[styles.cardTitle, { color: colors.text }]}>
                Personal Records
              </ThemedText>
              <View style={styles.recordsContainer}>
                <View style={styles.recordRow}>
                  <ThemedText
                    style={[
                      styles.recordLabel,
                      { color: colors.secondaryText },
                    ]}
                  >
                    🏋️‍♂️ Snatch
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.recordValue,
                      { color: colors.wrappedPrimary },
                    ]}
                  >
                    {wrappedStats.bestSnatch}
                    kg
                  </ThemedText>
                </View>
                <View style={styles.recordRow}>
                  <ThemedText
                    style={[
                      styles.recordLabel,
                      { color: colors.secondaryText },
                    ]}
                  >
                    💪 Clean & Jerk
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.recordValue,
                      { color: colors.wrappedAccent },
                    ]}
                  >
                    {wrappedStats.bestCleanJerk}
                    kg
                  </ThemedText>
                </View>
                <View style={styles.recordRow}>
                  <ThemedText
                    style={[
                      styles.recordLabel,
                      { color: colors.secondaryText },
                    ]}
                  >
                    🏆 Total
                  </ThemedText>
                  <ThemedText
                    style={[styles.recordValue, { color: colors.success }]}
                  >
                    {wrappedStats.bestTotal}
                    kg
                  </ThemedText>
                </View>
              </View>
            </View>

            {/* Performance Card */}
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <ThemedText style={[styles.cardTitle, { color: colors.text }]}>
                Performance Stats
              </ThemedText>
              <View style={styles.performanceContainer}>
                <View style={styles.performanceRow}>
                  <ThemedText
                    style={[
                      styles.performanceLabel,
                      { color: colors.secondaryText },
                    ]}
                  >
                    Make Percentage
                  </ThemedText>
                  <ThemedText
                    style={[styles.performanceValue, { color: colors.success }]}
                  >
                    {wrappedStats.makePercentage.toFixed(1)}
%
</ThemedText>
                </View>
                <View style={styles.performanceRow}>
                  <ThemedText
                    style={[
                      styles.performanceLabel,
                      { color: colors.secondaryText },
                    ]}
                  >
                    Average Total
                  </ThemedText>
                  <ThemedText
                    style={[styles.performanceValue, { color: colors.text }]}
                  >
                    {wrappedStats.averageTotal.toFixed(0)}
                    kg
                  </ThemedText>
                </View>
                <View style={styles.performanceRow}>
                  <ThemedText
                    style={[
                      styles.performanceLabel,
                      { color: colors.secondaryText },
                    ]}
                  >
                    Best Meet
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.performanceValue,
                      { color: colors.wrappedPrimary },
                    ]}
                  >
                    {wrappedStats.topMeet}
                  </ThemedText>
                </View>
              </View>
            </View>

            {/* Share Button */}
            <View style={styles.shareContainer}>
              <Pressable
                style={[
                  styles.shareButton,
                  { backgroundColor: colors.wrappedPrimary },
                ]}
                onPress={shareWrapped}
              >
                <IconSymbol
                  name="square.and.arrow.up"
                  size={20}
                  color="#FFFFFF"
                />
                <ThemedText style={styles.shareButtonText}>
                  Share Your Wrapped
                </ThemedText>
              </Pressable>

              <Pressable
                style={[
                  styles.backButton,
                  {
                    backgroundColor: colors.background,
                    borderWidth: 1,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => setShowStats(false)}
              >
                <IconSymbol name="arrow.left" size={20} color={colors.text} />
                <ThemedText
                  style={[styles.backButtonText, { color: colors.text }]}
                >
                  Search Again
                </ThemedText>
              </Pressable>
            </View>
          </>
        ) : (
          /* Info Section */
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <ThemedText style={[styles.cardTitle, { color: colors.text }]}>
              About Weightlifting Wrapped
            </ThemedText>
            <ThemedText
              style={[styles.infoText, { color: colors.secondaryText }]}
            >
              Discover your year in weightlifting! See your total weight lifted,
              success rates, personal records, and more in a fun, shareable
              format.
            </ThemedText>
          </View>
        )}
      </ScrollView>
    </ThemedView>
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
    paddingTop: 70,
  },
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 16,
  },
  inputContainer: {
    marginBottom: 16,
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  yearSelector: {
    marginBottom: 20,
  },
  yearLabel: {
    fontSize: 16,
    fontWeight: "500",
    marginBottom: 8,
  },
  yearChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
  },
  yearChipText: {
    fontSize: 14,
    fontWeight: "500",
  },
  searchButton: {
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
  },
  searchButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  infoText: {
    fontSize: 14,
    lineHeight: 20,
  },
  yearOverview: {
    alignItems: "center",
    paddingVertical: 8,
  },
  yearRank: {
    fontSize: 18,
    fontWeight: "500",
    textAlign: "center",
    marginBottom: 8,
  },
  overview: {
    fontSize: 14,
    textAlign: "center",
  },
  statContainer: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
    marginVertical: 8,
    flexWrap: "wrap",
  },
  bigStatNumber: {
    fontSize: 40,
    fontWeight: "900",
    textAlign: "center",
    flexShrink: 1,
  },
  statUnit: {
    fontSize: 20,
    fontWeight: "500",
    marginLeft: 4,
  },
  statDescription: {
    fontSize: 14,
    textAlign: "center",
    marginTop: 8,
  },
  recordsContainer: {
    gap: 12,
  },
  recordRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: 8,
  },
  performanceContainer: {
    gap: 12,
  },
  performanceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  performanceLabel: {
    fontSize: 16,
    fontWeight: "500",
  },
  performanceValue: {
    fontSize: 16,
    fontWeight: "600",
  },
  shareContainer: {
    gap: 12,
    marginTop: 8,
  },
  shareButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  shareButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
