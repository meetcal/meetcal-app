import { IconSymbol } from "@/components/ui/IconSymbol";
import { api } from "@/convex/_generated/api";
import { convex } from "@/lib/convex";
import {
  isNetworkAvailable,
  subscribeToNetworkChanges,
} from "@/lib/networkUtils";
import { LiftingResult, WrappedStats } from "@/types/wrapped";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ViewShot, { captureRef } from "react-native-view-shot";

const YEARS = Array.from(
  { length: 10 },
  (_, i) => new Date().getFullYear() - i,
);

const SLIDE_GRADIENTS: [string, string, string][] = [
  ["#4A0E8F", "#9C27B0", "#C2185B"],
  ["#004D40", "#0D7377", "#14FFEC"],
  ["#B71C1C", "#D91A60", "#FF6F00"],
  ["#0D47A1", "#1565C0", "#00BCD4"],
  ["#BF360C", "#E65100", "#FF8F00"],
  ["#311B92", "#4527A0", "#7C4DFF"],
  ["#1B1B2F", "#162447", "#1DB954"],
];

const SLIDE_COUNT = 7;

function AnimatedCounter({
  value,
  duration = 1500,
  delay = 300,
  suffix = "",
  decimals = 0,
  style,
}: {
  value: number;
  duration?: number;
  delay?: number;
  suffix?: string;
  decimals?: number;
  style?: any;
}) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    let start = 0;
    const end = value;
    const startTime = Date.now() + delay;
    const endTime = startTime + duration;

    const tick = () => {
      const now = Date.now();
      if (now < startTime) {
        requestAnimationFrame(tick);
        return;
      }
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(eased * end * Math.pow(10, decimals)) / Math.pow(10, decimals));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value, duration, delay, decimals]);

  const formatted = decimals > 0
    ? display.toFixed(decimals)
    : display.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return <Text style={style}>{formatted}{suffix}</Text>;
}

function PulsingDot({ active }: { active: boolean }) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (active) {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.3, { duration: 600 }),
          withTiming(1, { duration: 600 }),
        ),
        -1,
        true,
      );
    } else {
      scale.value = withTiming(1, { duration: 200 });
    }
  }, [active, scale]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    width: active ? 24 : 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: active ? "#FFFFFF" : "rgba(255,255,255,0.4)",
    marginHorizontal: 3,
  }));

  return <Animated.View style={animStyle} />;
}

function SlideContent({
  children,
  active,
}: {
  children: React.ReactNode;
  active: boolean;
}) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(40);

  useEffect(() => {
    if (active) {
      opacity.value = withDelay(200, withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) }));
      translateY.value = withDelay(200, withSpring(0, { damping: 20, stiffness: 90 }));
    } else {
      opacity.value = 0;
      translateY.value = 40;
    }
  }, [active, opacity, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={[styles.slideContentInner, animStyle]}>{children}</Animated.View>;
}

export default function WeightliftingWrappedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [loading, setLoading] = useState(false);
  const [wrappedStats, setWrappedStats] = useState<WrappedStats | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [athleteName, setAthleteName] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const viewShotRef = useRef<any>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let mounted = true;
    isNetworkAvailable()
      .then((hasNetwork) => {
        if (mounted) setIsOffline(!hasNetwork);
      })
      .catch(() => {
        if (mounted) setIsOffline(false);
      });
    const unsubscribe = subscribeToNetworkChanges((isConnected) => {
      setIsOffline(!isConnected);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.trim().length < 4) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    setLoadingSuggestions(true);
    try {
      const names: string[] = await convex.query(api.athletes.searchByName, { query: query.trim() });
      const words = query.trim().toLowerCase().split(/\s+/);
      const filtered = names.filter((name) => {
        const lower = name.toLowerCase();
        return words.every((w) => lower.includes(w));
      });
      setSuggestions(filtered.slice(0, 8));
      setShowSuggestions(filtered.length > 0);
    } catch {
      setSuggestions([]);
      setShowSuggestions(false);
    } finally {
      setLoadingSuggestions(false);
    }
  }, []);

  const onSearchTextChange = useCallback((text: string) => {
    setSearchQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 4) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    debounceRef.current = setTimeout(() => fetchSuggestions(text), 350);
  }, [fetchSuggestions]);

  const selectSuggestion = useCallback((name: string) => {
    setSearchQuery(name);
    setSuggestions([]);
    setShowSuggestions(false);
  }, []);

  const searchAthlete = async () => {
    if (!searchQuery.trim()) {
      Alert.alert("Error", "Please enter an athlete name");
      return;
    }

    setShowSuggestions(false);
    setLoading(true);
    try {
      const normalizedName = searchQuery.trim();
      const startDate = `${selectedYear}-01-01`;
      const endDate = `${selectedYear + 1}-01-01`;

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

      if (data.length === 0) {
        const searchRows = await convex.query(api.liftingResults.searchByNameAndYear, {
          query: normalizedName,
          startDate,
          endDate,
        });
        const words = normalizedName.toLowerCase().split(/\s+/);
        data = searchRows
          .filter((r: any) => {
            const lower = (r.name || "").toLowerCase();
            return words.every((w) => lower.includes(w));
          })
          .slice(0, 600).map((r: any): LiftingResult => ({
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
        Alert.alert("No Results", `No results found for ${searchQuery} in ${selectedYear}`);
        return;
      }

      setAthleteName(data[0].name || normalizedName);
      const stats = calculateWrappedStats(data);
      setWrappedStats(stats);
      setCurrentSlide(0);
      setShowStats(true);
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
      [result.snatch1, result.snatch2, result.snatch3, result.cj1, result.cj2, result.cj3].forEach((attempt) => {
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

      if (result.snatch_best) bestSnatch = Math.max(bestSnatch, result.snatch_best);
      if (result.cj_best) bestCJ = Math.max(bestCJ, result.cj_best);
      if (result.total) {
        bestTotal = Math.max(bestTotal, result.total);
        totalSum += result.total;
        validTotals++;
        meetTotals[result.meet] = Math.max(meetTotals[result.meet] || 0, result.total);
      }
    });

    const makePercentage = totalAttempts > 0 ? (successfulAttempts / totalAttempts) * 100 : 0;
    const averageTotal = validTotals > 0 ? totalSum / validTotals : 0;
    const topMeet = Object.keys(meetTotals).reduce(
      (a, b) => (meetTotals[a] > meetTotals[b] ? a : b),
      Object.keys(meetTotals)[0] || "N/A",
    );
    const firstTotal = data[0]?.total || 0;
    const lastTotal = data[data.length - 1]?.total || 0;
    const improvement = lastTotal - firstTotal;

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
      attemptCounts[a as keyof typeof attemptCounts] > attemptCounts[b as keyof typeof attemptCounts] ? a : b,
    );

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

  const goToSlide = useCallback((index: number) => {
    if (index >= 0 && index < SLIDE_COUNT) {
      flatListRef.current?.scrollToIndex({ index, animated: true });
      setCurrentSlide(index);
    }
  }, []);

  const handleTap = useCallback((x: number) => {
    if (x < screenWidth * 0.3) {
      goToSlide(currentSlide - 1);
    } else if (x > screenWidth * 0.7) {
      goToSlide(currentSlide + 1);
    }
  }, [currentSlide, screenWidth, goToSlide]);

  const shareWrapped = async () => {
    try {
      if (!viewShotRef.current) return;
      const uri = await captureRef(viewShotRef, {
        format: "png",
        quality: 1,
        result: "tmpfile",
      });
      if (Platform.OS === "ios") {
        await Share.share({ url: uri });
      } else {
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(uri, {
            mimeType: "image/png",
            dialogTitle: `My ${selectedYear} Weightlifting Wrapped!`,
          });
        } else {
          throw new Error("Sharing not available");
        }
      }
    } catch (error) {
      if (!wrappedStats) return;
      const shareText = `My ${selectedYear} Weightlifting Wrapped!\n\nTotal Weight Lifted: ${wrappedStats.totalWeightLifted.toLocaleString()}kg\nMake Percentage: ${wrappedStats.makePercentage.toFixed(1)}%\nBest Total: ${wrappedStats.bestTotal}kg\nSnatch PR: ${wrappedStats.bestSnatch}kg\nClean & Jerk PR: ${wrappedStats.bestCleanJerk}kg\nCompeted in ${wrappedStats.totalMeets} meets\nStatus: ${wrappedStats.yearRank}\n\n#WeightliftingWrapped`;
      await Share.share({ message: shareText });
    }
  };

  const onMomentumScrollEnd = useCallback((e: any) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
    setCurrentSlide(index);
  }, [screenWidth]);

  const renderSlide = useCallback(({ item, index }: { item: number; index: number }) => {
    if (!wrappedStats) return null;
    const isActive = currentSlide === index;
    const gradient = SLIDE_GRADIENTS[index];

    return (
      <View style={{ width: screenWidth, height: screenHeight }}>
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.slideOverlay} />

        <Pressable
          style={[styles.slideContainer, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 60 }]}
          onPress={(e) => handleTap(e.nativeEvent.locationX)}
        >
          <SlideContent active={isActive}>
            {index === 0 && <TitleSlide name={athleteName} year={selectedYear} stats={wrappedStats} active={isActive} />}
            {index === 1 && <TotalWeightSlide stats={wrappedStats} active={isActive} />}
            {index === 2 && <PersonalRecordsSlide stats={wrappedStats} active={isActive} />}
            {index === 3 && <ConsistencySlide stats={wrappedStats} active={isActive} />}
            {index === 4 && <MeetJourneySlide stats={wrappedStats} year={selectedYear} active={isActive} />}
            {index === 5 && <FavoriteAttemptSlide stats={wrappedStats} active={isActive} />}
            {index === 6 && (
              <ShareSlide
                stats={wrappedStats}
                name={athleteName}
                year={selectedYear}
              />
            )}
          </SlideContent>
        </Pressable>
      </View>
    );
  }, [wrappedStats, currentSlide, screenWidth, screenHeight, insets, athleteName, selectedYear, handleTap, shareWrapped]);

  if (showStats && wrappedStats) {
    return (
      <View style={styles.storyContainer}>
        <Stack.Screen options={{ headerShown: false }} />
        <ViewShot ref={viewShotRef} style={StyleSheet.absoluteFill} options={{ format: "png", quality: 1 }}>
          <FlatList
            ref={flatListRef}
            data={Array.from({ length: SLIDE_COUNT }, (_, i) => i)}
            renderItem={renderSlide}
            keyExtractor={(item) => item.toString()}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            bounces={false}
            onMomentumScrollEnd={onMomentumScrollEnd}
            getItemLayout={(_, index) => ({ length: screenWidth, offset: screenWidth * index, index })}
            initialScrollIndex={0}
          />
        </ViewShot>

        <View style={[styles.dotsContainer, { bottom: insets.bottom + 16 }]}>
          {Array.from({ length: SLIDE_COUNT }, (_, i) => (
            <Pressable key={i} onPress={() => goToSlide(i)}>
              <PulsingDot active={currentSlide === i} />
            </Pressable>
          ))}
        </View>

        <Pressable
          style={[styles.closeButton, { top: insets.top + 8 }]}
          onPress={() => {
            setShowStats(false);
            setCurrentSlide(0);
          }}
          hitSlop={16}
        >
          <View style={styles.closeButtonBg}>
            <IconSymbol name="xmark" size={18} color="#FFFFFF" />
          </View>
        </Pressable>

        {currentSlide === SLIDE_COUNT - 1 && (
          <View style={[styles.shareOverlay, { bottom: insets.bottom + 48 }]}>
            <Pressable
              style={({ pressed }) => [styles.shareActionButton, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
              onPress={shareWrapped}
            >
              <LinearGradient
                colors={["#1DB954", "#1ed760"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.shareActionGradient}
              >
                <IconSymbol name="square.and.arrow.up" size={20} color="#000000" />
                <Text style={styles.shareActionText}>SHARE YOUR WRAPPED</Text>
              </LinearGradient>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.searchAgainButton, pressed && { opacity: 0.7 }]}
              onPress={() => {
                setShowStats(false);
                setCurrentSlide(0);
              }}
            >
              <Text style={styles.searchAgainText}>Search Another Athlete</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.storyContainer}>
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />
      <LinearGradient
        colors={["#1B1B2F", "#162447", "#0F3460"]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      <Pressable
        style={[styles.backNavButton, { top: insets.top + 8 }]}
        onPress={() => router.back()}
        hitSlop={16}
      >
        <View style={styles.backNavButtonBg}>
          <IconSymbol name="chevron.left" size={20} color="#FFFFFF" />
        </View>
      </Pressable>

      <ScrollView
        style={styles.searchScroll}
        contentContainerStyle={[
          styles.searchScrollContent,
          { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {isOffline && (
          <View style={styles.offlineBanner}>
            <IconSymbol name="wifi.slash" size={16} color="rgba(255,255,255,0.9)" />
            <Text style={styles.offlineBannerText}>
              This feature requires a connection. Connect to the internet to use Weightlifting Wrapped.
            </Text>
          </View>
        )}
        <Animated.View entering={FadeInDown.duration(600).delay(100)}>
          <Text style={styles.searchPreTitle}>YOUR</Text>
          <Text style={styles.searchTitle}>YEAR IN{"\n"}LIFTING</Text>
          <View style={styles.searchTitleAccent} />
        </Animated.View>

        <Animated.View entering={FadeInUp.duration(500).delay(300)} style={styles.searchCard}>
          <Text style={styles.inputLabel}>ATHLETE NAME</Text>
          <View style={styles.inputWrapper}>
            <IconSymbol name="magnifyingglass" size={18} color="rgba(255,255,255,0.5)" />
            <TextInput
              style={styles.searchInput}
              placeholder="Start typing a name..."
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={searchQuery}
              onChangeText={onSearchTextChange}
              autoCapitalize="words"
              returnKeyType="search"
              onSubmitEditing={searchAthlete}
            />
            {loadingSuggestions && (
              <ActivityIndicator size="small" color="rgba(255,255,255,0.5)" style={{ marginRight: 4 }} />
            )}
          </View>
          {showSuggestions && suggestions.length > 0 && (
            <View style={styles.suggestionsContainer}>
              {suggestions.map((name) => (
                <Pressable
                  key={name}
                  style={({ pressed }) => [styles.suggestionRow, pressed && styles.suggestionRowPressed]}
                  onPress={() => selectSuggestion(name)}
                >
                  <IconSymbol name="magnifyingglass" size={14} color="rgba(255,255,255,0.35)" />
                  <Text style={styles.suggestionText} numberOfLines={1}>{name}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <Text style={styles.inputLabel}>SELECT YEAR</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.yearRow}
            style={styles.yearScroll}
          >
            {YEARS.map((year) => {
              const isSelected = selectedYear === year;
              return (
                <Pressable
                  key={year}
                  onPress={() => setSelectedYear(year)}
                  style={[styles.yearPill, isSelected && styles.yearPillActive]}
                >
                  <Text style={[styles.yearPillText, isSelected && styles.yearPillTextActive]}>
                    {year}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable
            style={({ pressed }) => [styles.unwrapButton, pressed && { opacity: 0.85 }]}
            onPress={searchAthlete}
            disabled={loading || isOffline}
          >
            <LinearGradient
              colors={["#1DB954", "#1ed760"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.unwrapButtonGradient}
            >
              {loading ? (
                <ActivityIndicator color="#000000" size="small" />
              ) : (
                <Text style={styles.unwrapButtonText}>UNWRAP MY YEAR</Text>
              )}
            </LinearGradient>
          </Pressable>
        </Animated.View>

        <Animated.View entering={FadeIn.duration(500).delay(600)}>
          <Text style={styles.searchFooter}>
            Discover your year in weightlifting.{"\n"}See your stats in a shareable format.
          </Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

function TitleSlide({ name, year, stats, active }: { name: string; year: number; stats: WrappedStats; active: boolean }) {
  return (
    <View style={styles.slideInner}>
      <Text style={styles.slideTopLabel}>WEIGHTLIFTING WRAPPED</Text>
      <View style={styles.titleSlideCenter}>
        <Text style={styles.titleSlideYear}>{year}</Text>
        <View style={styles.titleDivider} />
        <Text style={styles.titleSlideName}>{name.toUpperCase()}</Text>
        <View style={styles.rankBadge}>
          <Text style={styles.rankBadgeText}>{stats.yearRank}</Text>
        </View>
      </View>
      <View style={styles.titleBottomRow}>
        <View style={styles.titleBottomStat}>
          <Text style={styles.titleBottomNumber}>{stats.totalMeets}</Text>
          <Text style={styles.titleBottomLabel}>meets</Text>
        </View>
        <View style={styles.titleBottomDivider} />
        <View style={styles.titleBottomStat}>
          <Text style={styles.titleBottomNumber}>{stats.makePercentage.toFixed(0)}%</Text>
          <Text style={styles.titleBottomLabel}>make rate</Text>
        </View>
        <View style={styles.titleBottomDivider} />
        <View style={styles.titleBottomStat}>
          <Text style={styles.titleBottomNumber}>{stats.bestTotal}</Text>
          <Text style={styles.titleBottomLabel}>best total</Text>
        </View>
      </View>
    </View>
  );
}

const FUN_FACT_GENERATORS: ((kg: number) => string)[] = [
  (kg) => `That's ${Math.round(kg / 1500).toLocaleString()} grand pianos`,
  (kg) => `That's ${Math.round(kg / 180).toLocaleString()} adult humans`,
  (kg) => `That's ${Math.round(kg / 5000).toLocaleString()} Toyota Camrys`,
  (kg) => `That's ${Math.round(kg / 6000).toLocaleString()} African elephants`,
  (kg) => `That's ${Math.round(kg / 0.45).toLocaleString()} sticks of butter`,
  (kg) => `That's ${Math.round(kg / 4.5).toLocaleString()} bowling balls`,
  (kg) => `That's ${Math.round(kg / 30).toLocaleString()} golden retrievers`,
  (kg) => `That's ${Math.round(kg / 900).toLocaleString()} grizzly bears`,
  (kg) => `That's ${Math.round(kg / 0.05).toLocaleString()} chicken nuggets`,
  (kg) => `That's ${Math.round(kg / 320).toLocaleString()} vending machines`,
  (kg) => `That's ${Math.round(kg / 635).toLocaleString()} concert grand pianos`,
  (kg) => `That's ${Math.round(kg / 0.028).toLocaleString()} AA batteries`,
  (kg) => `That's ${Math.round(kg / 2000).toLocaleString()} SmartCars`,
  (kg) => `That's ${Math.round(kg / 0.5).toLocaleString()} baseballs`,
  (kg) => `That's ${Math.round(kg / 150).toLocaleString()} refrigerators`,
  (kg) => `That's ${Math.round(kg / 0.2).toLocaleString()} bananas`,
  (kg) => `That's ${Math.round(kg / 80).toLocaleString()} Labrador Retrievers`,
  (kg) => `That's ${Math.round(kg / 5.5).toLocaleString()} house cats`,
  (kg) => `That's ${Math.round(kg / 113).toLocaleString()} kegs of beer`,
  (kg) => `That's ${Math.round(kg / 0.007).toLocaleString()} paperclips`,
  (kg) => `That's ${Math.round(kg / 20).toLocaleString()} car tires`,
  (kg) => `That's ${Math.round(kg / 45000).toLocaleString()} school buses`,
  (kg) => `That's ${Math.round(kg / 0.14).toLocaleString()} iPhones`,
];

function TotalWeightSlide({ stats, active }: { stats: WrappedStats; active: boolean }) {
  const funFact = useMemo(() => {
    const valid = FUN_FACT_GENERATORS.filter((fn) => {
      const val = fn(stats.totalWeightLifted);
      const num = parseInt(val.replace(/\D/g, ""));
      return num >= 1;
    });
    const pick = valid[Math.floor(Math.random() * valid.length)] || FUN_FACT_GENERATORS[1];
    return pick(stats.totalWeightLifted);
  }, [stats.totalWeightLifted]);

  return (
    <View style={styles.slideInner}>
      <Text style={styles.slideTopLabel}>TOTAL WEIGHT LIFTED</Text>
      <View style={styles.heroStatCenter}>
        <Text style={styles.heroStatPrefix}>YOU LIFTED</Text>
        {active ? (
          <AnimatedCounter
            value={stats.totalWeightLifted}
            duration={2000}
            delay={400}
            style={styles.heroStatNumber}
          />
        ) : (
          <Text style={styles.heroStatNumber}>0</Text>
        )}
        <Text style={styles.heroStatSuffix}>KILOGRAMS</Text>
        <View style={styles.funFactCard}>
          <Text style={styles.funFactText}>{funFact}</Text>
        </View>
      </View>
    </View>
  );
}

function PersonalRecordsSlide({ stats, active }: { stats: WrappedStats; active: boolean }) {
  return (
    <View style={styles.slideInner}>
      <Text style={styles.slideTopLabel}>PERSONAL RECORDS</Text>
      <View style={styles.prCenter}>
        <View style={styles.prCard}>
          <Text style={styles.prLabel}>SNATCH</Text>
          {active ? (
            <AnimatedCounter value={stats.bestSnatch} delay={300} suffix="kg" style={styles.prValue} />
          ) : (
            <Text style={styles.prValue}>0kg</Text>
          )}
        </View>
        <View style={[styles.prCard, styles.prCardLarge]}>
          <Text style={styles.prLabelLarge}>BEST TOTAL</Text>
          {active ? (
            <AnimatedCounter value={stats.bestTotal} delay={600} suffix="kg" style={styles.prValueLarge} />
          ) : (
            <Text style={styles.prValueLarge}>0kg</Text>
          )}
        </View>
        <View style={styles.prCard}>
          <Text style={styles.prLabel}>CLEAN & JERK</Text>
          {active ? (
            <AnimatedCounter value={stats.bestCleanJerk} delay={900} suffix="kg" style={styles.prValue} />
          ) : (
            <Text style={styles.prValue}>0kg</Text>
          )}
        </View>
      </View>
    </View>
  );
}

function ConsistencySlide({ stats, active }: { stats: WrappedStats; active: boolean }) {
  const percentage = stats.makePercentage;
  const ringSize = 220;
  const strokeWidth = 10;
  const radius = (ringSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const progress = useSharedValue(0);

  useEffect(() => {
    if (active) {
      progress.value = withDelay(
        500,
        withTiming(percentage / 100, { duration: 1500, easing: Easing.out(Easing.cubic) }),
      );
    } else {
      progress.value = 0;
    }
  }, [active, percentage, progress]);

  return (
    <View style={styles.slideInner}>
      <Text style={styles.slideTopLabel}>CONSISTENCY</Text>
      <View style={styles.consistencyCenter}>
        <View style={[styles.ringContainer, { width: ringSize, height: ringSize }]}>
          <View style={styles.ringInner}>
            <View style={styles.ringValueRow}>
              {active ? (
                <AnimatedCounter
                  value={percentage}
                  decimals={1}
                  delay={500}
                  style={styles.ringPercentage}
                />
              ) : (
                <Text style={styles.ringPercentage}>0</Text>
              )}
              <Text style={styles.ringPercent}>%</Text>
            </View>
            <Text style={styles.ringLabel}>MAKE RATE</Text>
          </View>
        </View>

        <View style={styles.consistencyStatsRow}>
          <View style={styles.consistencyStat}>
            {active ? (
              <AnimatedCounter value={stats.consecutiveMakes} delay={800} style={styles.consistencyStatNumber} />
            ) : (
              <Text style={styles.consistencyStatNumber}>0</Text>
            )}
            <Text style={styles.consistencyStatLabel}>CONSECUTIVE{"\n"}MAKES</Text>
          </View>
          <View style={styles.consistencyStatDivider} />
          <View style={styles.consistencyStat}>
            <Text style={styles.consistencyStatNumber}>
              {percentage >= 80 ? "ELITE" : percentage >= 60 ? "SOLID" : "GROWING"}
            </Text>
            <Text style={styles.consistencyStatLabel}>ACCURACY{"\n"}TIER</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function MeetJourneySlide({ stats, year, active }: { stats: WrappedStats; year: number; active: boolean }) {
  const improvementText = stats.improvementFromFirst > 0
    ? `+${stats.improvementFromFirst}kg`
    : stats.improvementFromFirst < 0
      ? `${stats.improvementFromFirst}kg`
      : "Steady";

  return (
    <View style={styles.slideInner}>
      <Text style={styles.slideTopLabel}>YOUR {year} JOURNEY</Text>
      <View style={styles.journeyCenter}>
        <View style={styles.journeyHero}>
          {active ? (
            <AnimatedCounter value={stats.totalMeets} delay={300} style={styles.journeyHeroNumber} />
          ) : (
            <Text style={styles.journeyHeroNumber}>0</Text>
          )}
          <Text style={styles.journeyHeroLabel}>MEETS COMPETED</Text>
        </View>

        <View style={styles.journeyCard}>
          <Text style={styles.journeyCardLabel}>TOP PERFORMANCE</Text>
          <Text style={styles.journeyCardValue} numberOfLines={2}>{stats.topMeet}</Text>
        </View>

        <View style={styles.journeyStatsRow}>
          <View style={styles.journeyStat}>
            <Text style={styles.journeyStatNumber}>{stats.averageTotal.toFixed(0)}kg</Text>
            <Text style={styles.journeyStatLabel}>AVG TOTAL</Text>
          </View>
          <View style={styles.journeyStat}>
            <Text style={[styles.journeyStatNumber, stats.improvementFromFirst > 0 && styles.positiveText]}>
              {improvementText}
            </Text>
            <Text style={styles.journeyStatLabel}>IMPROVEMENT</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function FavoriteAttemptSlide({ stats, active }: { stats: WrappedStats; active: boolean }) {
  const attemptDescriptions: Record<string, string> = {
    "1st": "You're an opener specialist.\nConfident and locked in from the start.",
    "2nd": "The second attempt is your sweet spot.\nBuild, then strike.",
    "3rd": "You save the best for last.\nClutch performer.",
  };

  const attemptTitles: Record<string, string> = {
    "1st": "THE OPENER",
    "2nd": "THE BUILDER",
    "3rd": "THE CLOSER",
  };

  return (
    <View style={styles.slideInner}>
      <Text style={styles.slideTopLabel}>YOUR IDENTITY</Text>
      <View style={styles.attemptCenter}>
        <Text style={styles.attemptOrdinal}>{stats.favoriteAttempt}</Text>
        <Text style={styles.attemptLabel}>ATTEMPT</Text>
        <View style={styles.attemptDivider} />
        <Text style={styles.attemptTitle}>
          {attemptTitles[stats.favoriteAttempt] || "THE LIFTER"}
        </Text>
        <View style={styles.attemptDescCard}>
          <Text style={styles.attemptDescription}>
            {attemptDescriptions[stats.favoriteAttempt] || "Every attempt counts."}
          </Text>
        </View>
      </View>
    </View>
  );
}

function ShareSlide({
  stats,
  name,
  year,
}: {
  stats: WrappedStats;
  name: string;
  year: number;
}) {
  return (
    <View style={styles.slideInner}>
      <Text style={styles.slideTopLabel}>THAT'S A WRAP</Text>
      <View style={styles.shareCenter}>
        <Text style={styles.shareYear}>{year}</Text>
        <Text style={styles.shareName}>{name.toUpperCase()}</Text>

        <View style={styles.shareSummaryGrid}>
          <View style={styles.shareSummaryItem}>
            <Text style={styles.shareSummaryValue}>{stats.bestSnatch}kg</Text>
            <Text style={styles.shareSummaryLabel}>SNATCH</Text>
          </View>
          <View style={styles.shareSummaryItem}>
            <Text style={styles.shareSummaryValue}>{stats.bestCleanJerk}kg</Text>
            <Text style={styles.shareSummaryLabel}>C&J</Text>
          </View>
          <View style={styles.shareSummaryItem}>
            <Text style={styles.shareSummaryValue}>{stats.bestTotal}kg</Text>
            <Text style={styles.shareSummaryLabel}>TOTAL</Text>
          </View>
          <View style={styles.shareSummaryItem}>
            <Text style={styles.shareSummaryValue}>{stats.makePercentage.toFixed(0)}%</Text>
            <Text style={styles.shareSummaryLabel}>MAKES</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  storyContainer: {
    flex: 1,
    backgroundColor: "#000",
  },

  backNavButton: {
    position: "absolute",
    left: 16,
    zIndex: 10,
  },
  backNavButtonBg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeButton: {
    position: "absolute",
    right: 16,
    zIndex: 10,
  },
  closeButtonBg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  shareOverlay: {
    position: "absolute",
    left: 24,
    right: 24,
    zIndex: 10,
    alignItems: "center",
  },

  dotsContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },

  slideContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  slideOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.15)",
  },
  slideContentInner: {
    flex: 1,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  slideInner: {
    flex: 1,
    width: "100%",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 20,
  },
  slideTopLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "rgba(255,255,255,0.6)",
    letterSpacing: 4,
    textAlign: "center",
    marginBottom: 20,
  },

  // Search screen
  searchScroll: {
    flex: 1,
  },
  searchScrollContent: {
    paddingHorizontal: 28,
    flexGrow: 1,
    justifyContent: "center",
  },
  searchPreTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1DB954",
    letterSpacing: 6,
    marginBottom: 4,
  },
  searchTitle: {
    fontSize: 52,
    fontWeight: "900",
    color: "#FFFFFF",
    lineHeight: 54,
    marginBottom: 12,
  },
  searchTitleAccent: {
    width: 48,
    height: 4,
    backgroundColor: "#1DB954",
    borderRadius: 2,
    marginBottom: 36,
  },
  searchCard: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 20,
    padding: 24,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "rgba(255,255,255,0.5)",
    letterSpacing: 2,
    marginBottom: 10,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    paddingHorizontal: 14,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  searchInput: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 10,
    fontSize: 16,
    color: "#FFFFFF",
    fontWeight: "500",
  },
  yearScroll: {
    marginBottom: 16,
  },
  yearRow: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  yearPill: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  yearPillActive: {
    backgroundColor: "#1DB954",
    borderColor: "#1DB954",
  },
  yearPillText: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255,255,255,0.5)",
  },
  yearPillTextActive: {
    color: "#000000",
    fontWeight: "800",
  },
  unwrapButton: {
    borderRadius: 30,
    overflow: "hidden",
  },
  unwrapButtonGradient: {
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 30,
  },
  unwrapButtonText: {
    fontSize: 16,
    fontWeight: "900",
    color: "#000000",
    letterSpacing: 2,
  },
  searchFooter: {
    fontSize: 14,
    color: "rgba(255,255,255,0.35)",
    textAlign: "center",
    lineHeight: 22,
  },
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,165,0,0.2)",
    borderWidth: 1,
    borderColor: "rgba(255,165,0,0.4)",
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
  },
  offlineBannerText: {
    flex: 1,
    fontSize: 14,
    color: "rgba(255,255,255,0.95)",
    lineHeight: 20,
  },

  // Title slide
  titleSlideCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  titleSlideYear: {
    fontSize: 96,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: -2,
    lineHeight: 96,
  },
  titleDivider: {
    width: 60,
    height: 3,
    backgroundColor: "rgba(255,255,255,0.4)",
    borderRadius: 2,
    marginVertical: 20,
  },
  titleSlideName: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 4,
    textAlign: "center",
    marginBottom: 20,
  },
  rankBadge: {
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  rankBadgeText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  titleBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    paddingBottom: 10,
  },
  titleBottomStat: {
    alignItems: "center",
  },
  titleBottomNumber: {
    fontSize: 24,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  titleBottomLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "rgba(255,255,255,0.5)",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: 2,
  },
  titleBottomDivider: {
    width: 1,
    height: 32,
    backgroundColor: "rgba(255,255,255,0.2)",
  },

  // Total weight slide
  heroStatCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  heroStatPrefix: {
    fontSize: 16,
    fontWeight: "700",
    color: "rgba(255,255,255,0.5)",
    letterSpacing: 4,
    marginBottom: 8,
  },
  heroStatNumber: {
    fontSize: 72,
    fontWeight: "900",
    color: "#FFFFFF",
    textAlign: "center",
    lineHeight: 80,
  },
  heroStatSuffix: {
    fontSize: 28,
    fontWeight: "800",
    color: "rgba(255,255,255,0.7)",
    letterSpacing: 8,
    marginTop: 4,
  },
  funFactCard: {
    backgroundColor: "rgba(0,0,0,0.25)",
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 16,
    marginTop: 32,
  },
  funFactText: {
    fontSize: 15,
    fontWeight: "600",
    color: "rgba(255,255,255,0.8)",
    textAlign: "center",
  },

  // PR slide
  prCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    gap: 16,
  },
  prCard: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 20,
    padding: 24,
    width: "100%",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  prCardLarge: {
    backgroundColor: "rgba(255,255,255,0.18)",
    borderColor: "rgba(255,255,255,0.25)",
    paddingVertical: 32,
  },
  prLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(255,255,255,0.5)",
    letterSpacing: 3,
    marginBottom: 6,
  },
  prValue: {
    fontSize: 40,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  prLabelLarge: {
    fontSize: 14,
    fontWeight: "700",
    color: "rgba(255,255,255,0.6)",
    letterSpacing: 3,
    marginBottom: 8,
  },
  prValueLarge: {
    fontSize: 56,
    fontWeight: "900",
    color: "#FFFFFF",
  },

  // Consistency slide
  consistencyCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 40,
  },
  ringContainer: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 120,
    borderWidth: 10,
    borderColor: "rgba(255,255,255,0.1)",
  },
  ringInner: {
    alignItems: "center",
    justifyContent: "center",
  },
  ringValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  ringPercentage: {
    fontSize: 44,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  ringPercent: {
    fontSize: 24,
    fontWeight: "800",
    color: "rgba(255,255,255,0.7)",
    marginLeft: 2,
  },
  ringLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(255,255,255,0.5)",
    letterSpacing: 3,
    marginTop: 2,
  },
  consistencyStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 24,
  },
  consistencyStat: {
    alignItems: "center",
    minWidth: 100,
  },
  consistencyStatNumber: {
    fontSize: 32,
    fontWeight: "900",
    color: "#FFFFFF",
    marginBottom: 4,
  },
  consistencyStatLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "rgba(255,255,255,0.5)",
    letterSpacing: 2,
    textAlign: "center",
    lineHeight: 16,
  },
  consistencyStatDivider: {
    width: 1,
    height: 48,
    backgroundColor: "rgba(255,255,255,0.2)",
  },

  // Journey slide
  journeyCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    gap: 24,
  },
  journeyHero: {
    alignItems: "center",
    marginBottom: 8,
  },
  journeyHeroNumber: {
    fontSize: 88,
    fontWeight: "900",
    color: "#FFFFFF",
    lineHeight: 92,
  },
  journeyHeroLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "rgba(255,255,255,0.5)",
    letterSpacing: 4,
    marginTop: 4,
  },
  journeyCard: {
    backgroundColor: "rgba(0,0,0,0.25)",
    borderRadius: 20,
    padding: 24,
    width: "100%",
    alignItems: "center",
  },
  journeyCardLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "rgba(255,255,255,0.4)",
    letterSpacing: 2,
    marginBottom: 8,
  },
  journeyCardValue: {
    fontSize: 20,
    fontWeight: "800",
    color: "#FFFFFF",
    textAlign: "center",
  },
  journeyStatsRow: {
    flexDirection: "row",
    gap: 16,
    width: "100%",
  },
  journeyStat: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
  },
  journeyStatNumber: {
    fontSize: 24,
    fontWeight: "900",
    color: "#FFFFFF",
    marginBottom: 4,
  },
  journeyStatLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "rgba(255,255,255,0.5)",
    letterSpacing: 2,
  },
  positiveText: {
    color: "#1DB954",
  },

  // Favorite attempt slide
  attemptCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  attemptOrdinal: {
    fontSize: 96,
    fontWeight: "900",
    color: "#FFFFFF",
    lineHeight: 96,
  },
  attemptLabel: {
    fontSize: 28,
    fontWeight: "800",
    color: "rgba(255,255,255,0.7)",
    letterSpacing: 8,
    marginBottom: 16,
  },
  attemptDivider: {
    width: 48,
    height: 3,
    backgroundColor: "rgba(255,255,255,0.3)",
    borderRadius: 2,
    marginVertical: 20,
  },
  attemptTitle: {
    fontSize: 32,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: 4,
    marginBottom: 24,
  },
  attemptDescCard: {
    backgroundColor: "rgba(0,0,0,0.25)",
    borderRadius: 20,
    paddingHorizontal: 28,
    paddingVertical: 20,
  },
  attemptDescription: {
    fontSize: 16,
    fontWeight: "500",
    color: "rgba(255,255,255,0.8)",
    textAlign: "center",
    lineHeight: 24,
  },

  // Share slide
  shareCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
  },
  shareYear: {
    fontSize: 56,
    fontWeight: "900",
    color: "#FFFFFF",
    lineHeight: 56,
  },
  shareName: {
    fontSize: 18,
    fontWeight: "800",
    color: "rgba(255,255,255,0.7)",
    letterSpacing: 4,
    marginTop: 8,
    marginBottom: 32,
    textAlign: "center",
  },
  shareSummaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    width: "100%",
    marginBottom: 36,
  },
  shareSummaryItem: {
    flex: 1,
    minWidth: "40%",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  shareSummaryValue: {
    fontSize: 28,
    fontWeight: "900",
    color: "#FFFFFF",
    marginBottom: 4,
  },
  shareSummaryLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "rgba(255,255,255,0.5)",
    letterSpacing: 2,
  },
  shareActionButton: {
    width: "100%",
    borderRadius: 30,
    overflow: "hidden",
    marginBottom: 16,
  },
  shareActionGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    gap: 10,
    borderRadius: 30,
  },
  shareActionText: {
    fontSize: 15,
    fontWeight: "900",
    color: "#000000",
    letterSpacing: 2,
  },
  searchAgainButton: {
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  searchAgainText: {
    fontSize: 15,
    fontWeight: "600",
    color: "rgba(255,255,255,0.6)",
    textDecorationLine: "underline",
  },

  suggestionsContainer: {
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 14,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  suggestionRowPressed: {
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  suggestionText: {
    fontSize: 15,
    fontWeight: "500",
    color: "rgba(255,255,255,0.85)",
    flex: 1,
  },
});
