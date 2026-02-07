import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Platform,
  Share
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { useTheme } from '@/contexts/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';


const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

interface LiftingResult {
  id: number;
  event_id: string;
  meet: string;
  date: string;
  name: string;
  age: number;
  body_weight: number;
  snatch1: number | null;
  snatch2: number | null;
  snatch3: number | null;
  snatch_best: number | null;
  cj1: number | null;
  cj2: number | null;
  cj3: number | null;
  cj_best: number | null;
  total: number | null;
}

interface WrappedStats {
  totalWeightLifted: number;
  totalMeets: number;
  makePercentage: number;
  bestSnatch: number;
  bestCleanJerk: number;
  bestTotal: number;
  averageTotal: number;
  topMeet: string;
  improvementFromFirst: number;
  consecutiveMakes: number;
  favoriteAttempt: string;
  yearRank: string;
}

const YEARS = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i);

export default function WeightliftingWrappedScreen() {
  const { currentTheme } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<LiftingResult[]>([]);
  const [wrappedStats, setWrappedStats] = useState<WrappedStats | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);
  
  // Animation refs
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(screenWidth)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;


  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    primary: '#1DB954', // Spotify green
    accent: '#FF6B6B',
    success: '#34C759',
    warning: '#FF9500',
  };

  const searchAthlete = async () => {
    if (!searchQuery.trim()) {
      Alert.alert('Error', 'Please enter an athlete name');
      return;
    }

    setLoading(true);
    try {
      const normalizedName = searchQuery.trim();
      const selectFields =
        'id,event_id,meet,date,name,age,body_weight,snatch1,snatch2,snatch3,snatch_best,cj1,cj2,cj3,cj_best,total';

      let { data, error } = await supabase
        .from('lifting_results')
        .select(selectFields)
        .eq('name', normalizedName)
        .gte('date', `${selectedYear}-01-01`)
        .lt('date', `${selectedYear + 1}-01-01`)
        .order('date', { ascending: true })
        .limit(600);

      if (!error && (!data || data.length === 0)) {
        const fallback = await supabase
          .from('lifting_results')
          .select(selectFields)
          .ilike('name', `%${normalizedName}%`)
          .gte('date', `${selectedYear}-01-01`)
          .lt('date', `${selectedYear + 1}-01-01`)
          .order('date', { ascending: true })
          .limit(600);
        data = fallback.data;
        error = fallback.error;
      }

      if (error) {
        console.error('Error searching athlete:', error);
        Alert.alert('Error', 'Failed to search for athlete');
        return;
      }

      if (!data || data.length === 0) {
        Alert.alert('No Results', `No results found for ${searchQuery} in ${selectedYear}`);
        return;
      }

      setResults(data);
      const stats = calculateWrappedStats(data);
      setWrappedStats(stats);
      setShowStats(true);
      setCurrentSlide(0);
      startAnimation();
    } catch (error) {
      console.error('Error in searchAthlete:', error);
      Alert.alert('Error', 'An unexpected error occurred');
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
    
    data.forEach(result => {
      // Calculate total weight lifted (sum of all successful attempts)
      [result.snatch1, result.snatch2, result.snatch3, result.cj1, result.cj2, result.cj3].forEach(attempt => {
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
    
    // Find top meet
    const topMeet = Object.keys(meetTotals).reduce((a, b) => 
      meetTotals[a] > meetTotals[b] ? a : b, Object.keys(meetTotals)[0] || 'N/A'
    );

    // Calculate improvement
    const firstTotal = data[0]?.total || 0;
    const lastTotal = data[data.length - 1]?.total || 0;
    const improvement = lastTotal - firstTotal;

    // Determine favorite attempt (most successful)
    const attemptCounts = { '1st': 0, '2nd': 0, '3rd': 0 };
    data.forEach(result => {
      if (result.snatch1 && result.snatch1 > 0) attemptCounts['1st']++;
      if (result.snatch2 && result.snatch2 > 0) attemptCounts['2nd']++;
      if (result.snatch3 && result.snatch3 > 0) attemptCounts['3rd']++;
      if (result.cj1 && result.cj1 > 0) attemptCounts['1st']++;
      if (result.cj2 && result.cj2 > 0) attemptCounts['2nd']++;
      if (result.cj3 && result.cj3 > 0) attemptCounts['3rd']++;
    });
    
    const favoriteAttempt = Object.keys(attemptCounts).reduce((a, b) => 
      attemptCounts[a as keyof typeof attemptCounts] > attemptCounts[b as keyof typeof attemptCounts] ? a : b
    );

    // Calculate rank (simplified)
    let yearRank = 'Rising Star';
    if (makePercentage >= 90) yearRank = 'Consistency King';
    else if (bestTotal >= 300) yearRank = 'Heavy Hitter';
    else if (data.length >= 5) yearRank = 'Meet Regular';

    return {
      totalWeightLifted: totalWeight,
      totalMeets: new Set(data.map(r => r.meet)).size,
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
      console.error('Error sharing wrapped:', error);
      Alert.alert('Error', 'Failed to share wrapped');
    }
  };

  const renderWrappedSlide = () => {
    if (!wrappedStats) return null;

    const slides = [
      // Slide 1: Year Overview
      {
        title: `Your ${selectedYear}`,
        subtitle: 'Weightlifting Wrapped',
        content: (
          <View style={styles.slideContent}>
            <ThemedText style={[styles.yearText, { color: colors.primary }]}>
              {selectedYear}
            </ThemedText>
            <ThemedText style={[styles.athleteName, { color: colors.text }]}>
              {searchQuery}
            </ThemedText>
            <ThemedText style={[styles.subtitle, { color: colors.secondaryText }]}>
              {wrappedStats.yearRank}
            </ThemedText>
            <View style={styles.statsPreview}>
              <ThemedText style={[styles.previewStat, { color: colors.accent }]}>
                {wrappedStats.totalMeets} meets • {wrappedStats.makePercentage.toFixed(0)}% success
              </ThemedText>
            </View>
          </View>
        ),
      },
      // Slide 2: Total Weight
      {
        title: 'Total Weight Lifted',
        content: (
          <View style={styles.slideContent}>
            <ThemedText style={[styles.bigNumber, { color: colors.accent }]}>
              {wrappedStats.totalWeightLifted.toLocaleString()}
            </ThemedText>
            <ThemedText style={[styles.unit, { color: colors.text }]}>kg</ThemedText>
            <ThemedText style={[styles.subtitle, { color: colors.secondaryText }]}>
              That&apos;s equivalent to lifting {Math.round(wrappedStats.totalWeightLifted / 180)} people!
            </ThemedText>
            <View style={styles.comparisonContainer}>
              <ThemedText style={[styles.comparisonText, { color: colors.secondaryText }]}>
                🚗 Or about {Math.round(wrappedStats.totalWeightLifted / 1500)} cars
              </ThemedText>
              <ThemedText style={[styles.comparisonText, { color: colors.secondaryText }]}>
                🦏 Or {Math.round(wrappedStats.totalWeightLifted / 2300)} rhinos
              </ThemedText>
            </View>
          </View>
        ),
      },
      // Slide 3: Success Rate
      {
        title: 'Make Percentage',
        content: (
          <View style={styles.slideContent}>
            <ThemedText style={[styles.bigNumber, { color: colors.success }]}>
              {wrappedStats.makePercentage.toFixed(1)}%
            </ThemedText>
            <ThemedText style={[styles.subtitle, { color: colors.secondaryText }]}>
              {wrappedStats.makePercentage >= 85 ? '🔥 Consistency Master!' : 
               wrappedStats.makePercentage >= 75 ? '💪 Solid Performer!' : 
               wrappedStats.makePercentage >= 65 ? '📈 Growing Strong!' : '🎯 Room to improve!'}
            </ThemedText>
            {wrappedStats.consecutiveMakes > 5 && (
              <View style={styles.streakContainer}>
                <ThemedText style={[styles.streakText, { color: colors.warning }]}>
                  🔥 Best streak: {wrappedStats.consecutiveMakes} consecutive makes!
                </ThemedText>
              </View>
            )}
          </View>
        ),
      },
      // Slide 4: Personal Bests
      {
        title: 'Personal Records',
        content: (
          <View style={styles.slideContent}>
            <View style={styles.recordsGrid}>
              <View style={styles.recordItem}>
                <ThemedText style={[styles.recordLabel, { color: colors.secondaryText }]}>
                  🏋️‍♂️ Snatch
                </ThemedText>
                <ThemedText style={[styles.recordValue, { color: colors.primary }]}>
                  {wrappedStats.bestSnatch}kg
                </ThemedText>
              </View>
              <View style={styles.recordItem}>
                <ThemedText style={[styles.recordLabel, { color: colors.secondaryText }]}>
                  💪 Clean & Jerk
                </ThemedText>
                <ThemedText style={[styles.recordValue, { color: colors.accent }]}>
                  {wrappedStats.bestCleanJerk}kg
                </ThemedText>
              </View>
              <View style={styles.recordItem}>
                <ThemedText style={[styles.recordLabel, { color: colors.secondaryText }]}>
                  🏆 Total
                </ThemedText>
                <ThemedText style={[styles.recordValue, { color: colors.success }]}>
                  {wrappedStats.bestTotal}kg
                </ThemedText>
              </View>
            </View>
            <View style={styles.ratioContainer}>
              <ThemedText style={[styles.ratioText, { color: colors.secondaryText }]}>
                Snatch to C&J ratio: {((wrappedStats.bestSnatch / wrappedStats.bestCleanJerk) * 100).toFixed(0)}%
              </ThemedText>
            </View>
          </View>
        ),
      },
      // Slide 5: Meet Activity & Growth
      {
        title: 'Competition Journey',
        content: (
          <View style={styles.slideContent}>
            <View style={styles.meetStatsContainer}>
              <View style={styles.meetStatItem}>
                <ThemedText style={[styles.meetStatNumber, { color: colors.primary }]}>
                  {wrappedStats.totalMeets}
                </ThemedText>
                <ThemedText style={[styles.meetStatLabel, { color: colors.text }]}>
                  Meets
                </ThemedText>
              </View>
              <View style={styles.meetStatItem}>
                <ThemedText style={[styles.meetStatNumber, { color: colors.accent }]}>
                  {wrappedStats.averageTotal.toFixed(0)}
                </ThemedText>
                <ThemedText style={[styles.meetStatLabel, { color: colors.text }]}>
                  Avg Total
                </ThemedText>
              </View>
            </View>
            <ThemedText style={[styles.subtitle, { color: colors.secondaryText }]}>
              🏆 Best performance at {wrappedStats.topMeet}
            </ThemedText>
            {wrappedStats.improvementFromFirst > 0 && (
              <ThemedText style={[styles.improvementText, { color: colors.success }]}>
                📈 Improved by {wrappedStats.improvementFromFirst}kg this year!
              </ThemedText>
            )}
            <ThemedText style={[styles.favoriteText, { color: colors.warning }]}>
              Most successful on {wrappedStats.favoriteAttempt} attempts
            </ThemedText>
          </View>
        ),
      },
    ];

    return slides[currentSlide];
  };

  const nextSlide = () => {
    const totalSlides = 5;
    if (currentSlide < totalSlides - 1) {
      setCurrentSlide(currentSlide + 1);
      // Reset and replay animation
      fadeAnim.setValue(0);
      slideAnim.setValue(screenWidth);
      startAnimation();
    }
  };

  const prevSlide = () => {
    if (currentSlide > 0) {
      setCurrentSlide(currentSlide - 1);
      // Reset and replay animation
      fadeAnim.setValue(0);
      slideAnim.setValue(-screenWidth);
      startAnimation();
    }
  };

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerTitle: 'Weightlifting Wrapped',
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
          { paddingBottom: insets.bottom + 20 }
        ]}
      >
        {/* Search Section */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <ThemedText style={[styles.cardTitle, { color: colors.text }]}>
            Find Your Wrapped
          </ThemedText>
          
          <View style={styles.inputContainer}>
            <TextInput
              style={[styles.searchInput, { 
                backgroundColor: colors.background,
                color: colors.text,
                borderColor: colors.border 
              }]}
              placeholder="Enter athlete name"
              placeholderTextColor={colors.secondaryText}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.yearSelector}>
            <ThemedText style={[styles.yearLabel, { color: colors.secondaryText }]}>
              Year
            </ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {YEARS.map(year => (
                <Pressable
                  key={year}
                  style={[
                    styles.yearChip,
                    { 
                      backgroundColor: selectedYear === year ? colors.primary : colors.background,
                      borderColor: colors.border 
                    }
                  ]}
                  onPress={() => setSelectedYear(year)}
                >
                  <ThemedText style={[
                    styles.yearChipText,
                    { color: selectedYear === year ? '#FFFFFF' : colors.text }
                  ]}>
                    {year}
                  </ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          <Pressable
            style={[styles.searchButton, { backgroundColor: colors.primary }]}
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
                Your {selectedYear} Weightlifting Year
              </ThemedText>
              <View style={styles.yearOverview}>
                <ThemedText style={[styles.athleteName, { color: colors.text }]}>
                  {searchQuery}
                </ThemedText>
                <ThemedText style={[styles.yearRank, { color: colors.primary }]}>
                  {wrappedStats.yearRank}
                </ThemedText>
                <ThemedText style={[styles.overview, { color: colors.secondaryText }]}>
                  {wrappedStats.totalMeets} meets • {wrappedStats.makePercentage.toFixed(0)}% success rate
                </ThemedText>
              </View>
            </View>

            {/* Total Weight Card */}
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <ThemedText style={[styles.cardTitle, { color: colors.text }]}>
                Total Weight Lifted
              </ThemedText>
              <View style={styles.statContainer}>
                <ThemedText style={[styles.bigStatNumber, { color: colors.accent }]}>
                  {wrappedStats.totalWeightLifted.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                </ThemedText>
                <ThemedText style={[styles.statUnit, { color: colors.text }]}>kg</ThemedText>
              </View>
              <ThemedText style={[styles.statDescription, { color: colors.secondaryText }]}>
                That&apos;s equivalent to lifting {Math.round(wrappedStats.totalWeightLifted / 180)} people!
              </ThemedText>
            </View>

            {/* Personal Records Card */}
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <ThemedText style={[styles.cardTitle, { color: colors.text }]}>
                Personal Records
              </ThemedText>
              <View style={styles.recordsContainer}>
                <View style={styles.recordRow}>
                  <ThemedText style={[styles.recordLabel, { color: colors.secondaryText }]}>
                    🏋️‍♂️ Snatch
                  </ThemedText>
                  <ThemedText style={[styles.recordValue, { color: colors.primary }]}>
                    {wrappedStats.bestSnatch}kg
                  </ThemedText>
                </View>
                <View style={styles.recordRow}>
                  <ThemedText style={[styles.recordLabel, { color: colors.secondaryText }]}>
                    💪 Clean & Jerk
                  </ThemedText>
                  <ThemedText style={[styles.recordValue, { color: colors.accent }]}>
                    {wrappedStats.bestCleanJerk}kg
                  </ThemedText>
                </View>
                <View style={styles.recordRow}>
                  <ThemedText style={[styles.recordLabel, { color: colors.secondaryText }]}>
                    🏆 Total
                  </ThemedText>
                  <ThemedText style={[styles.recordValue, { color: colors.success }]}>
                    {wrappedStats.bestTotal}kg
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
                  <ThemedText style={[styles.performanceLabel, { color: colors.secondaryText }]}>
                    Make Percentage
                  </ThemedText>
                  <ThemedText style={[styles.performanceValue, { color: colors.success }]}>
                    {wrappedStats.makePercentage.toFixed(1)}%
                  </ThemedText>
                </View>
                <View style={styles.performanceRow}>
                  <ThemedText style={[styles.performanceLabel, { color: colors.secondaryText }]}>
                    Average Total
                  </ThemedText>
                  <ThemedText style={[styles.performanceValue, { color: colors.text }]}>
                    {wrappedStats.averageTotal.toFixed(0)}kg
                  </ThemedText>
                </View>
                <View style={styles.performanceRow}>
                  <ThemedText style={[styles.performanceLabel, { color: colors.secondaryText }]}>
                    Best Meet
                  </ThemedText>
                  <ThemedText style={[styles.performanceValue, { color: colors.primary }]}>
                    {wrappedStats.topMeet}
                  </ThemedText>
                </View>
              </View>
            </View>

            {/* Share Button */}
            <View style={styles.shareContainer}>
              <Pressable
                style={[styles.shareButton, { backgroundColor: colors.primary }]}
                onPress={shareWrapped}
              >
                <IconSymbol name="square.and.arrow.up" size={20} color="#FFFFFF" />
                <ThemedText style={styles.shareButtonText}>Share Your Wrapped</ThemedText>
              </Pressable>
              
              <Pressable
                style={[styles.backButton, { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }]}
                onPress={() => setShowStats(false)}
              >
                <IconSymbol name="arrow.left" size={20} color={colors.text} />
                <ThemedText style={[styles.backButtonText, { color: colors.text }]}>Search Again</ThemedText>
              </Pressable>
            </View>
          </>
        ) : (
          /* Info Section */
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <ThemedText style={[styles.cardTitle, { color: colors.text }]}>
              About Weightlifting Wrapped
            </ThemedText>
            <ThemedText style={[styles.infoText, { color: colors.secondaryText }]}>
              Discover your year in weightlifting! See your total weight lifted, success rates, personal records, and more in a fun, shareable format.
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '600',
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
    fontWeight: '500',
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
    fontWeight: '500',
  },
  searchButton: {
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  searchButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  infoText: {
    fontSize: 14,
    lineHeight: 20,
  },
  wrappedContainer: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  wrappedSlide: {
    flex: 1,
    borderRadius: 20,
    padding: 30,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  slideTitle: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  slideSubtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 30,
  },
  slideContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  yearText: {
    fontSize: 72,
    fontWeight: '900',
    textAlign: 'center',
  },
  athleteName: {
    fontSize: 28,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 10,
  },
  bigNumber: {
    fontSize: 64,
    fontWeight: '900',
    textAlign: 'center',
  },
  unit: {
    fontSize: 24,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 22,
  },
  recordsGrid: {
    width: '100%',
    gap: 20,
  },
  recordItem: {
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  recordLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  recordValue: {
    fontSize: 32,
    fontWeight: '700',
  },
  navigation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  navButton: {
    padding: 12,
  },
  slideIndicator: {
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  statsPreview: {
    marginTop: 16,
    padding: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
  },
  previewStat: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  comparisonContainer: {
    marginTop: 20,
    gap: 8,
  },
  comparisonText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 18,
  },
  streakContainer: {
    marginTop: 20,
    padding: 12,
    backgroundColor: 'rgba(255, 149, 0, 0.1)',
    borderRadius: 8,
  },
  streakText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  ratioContainer: {
    marginTop: 16,
    padding: 8,
  },
  ratioText: {
    fontSize: 13,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  meetStatsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 20,
  },
  meetStatItem: {
    alignItems: 'center',
  },
  meetStatNumber: {
    fontSize: 48,
    fontWeight: '900',
  },
  meetStatLabel: {
    fontSize: 16,
    fontWeight: '500',
    marginTop: 4,
  },
  improvementText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 12,
  },
  favoriteText: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
  },
  // New card-based layout styles
  yearOverview: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  yearRank: {
    fontSize: 18,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: 8,
  },
  overview: {
    fontSize: 14,
    textAlign: 'center',
  },
  statContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    marginVertical: 8,
    flexWrap: 'wrap',
  },
  bigStatNumber: {
    fontSize: 40,
    fontWeight: '900',
    textAlign: 'center',
    flexShrink: 1,
  },
  statUnit: {
    fontSize: 20,
    fontWeight: '500',
    marginLeft: 4,
  },
  statDescription: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
  recordsContainer: {
    gap: 12,
  },
  recordRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
  },
  performanceContainer: {
    gap: 12,
  },
  performanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  performanceLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  performanceValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  shareContainer: {
    gap: 12,
    marginTop: 8,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  shareButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
