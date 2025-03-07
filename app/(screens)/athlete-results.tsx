import { StyleSheet, View, ScrollView, ActivityIndicator } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { useTheme } from '@/contexts/ThemeContext';
import { useMemo, useState, useEffect } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';

// First, add the interface for Supabase results
interface SupabaseLiftResult {
  id: number;
  event_id: string;
  meet: string;
  date: string;
  name: string;
  age: string;
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

export default function AthleteResultsScreen() {
  const { currentTheme } = useTheme();
  const { name } = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [athleteResults, setAthleteResults] = useState<SupabaseLiftResult[]>([]);

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    success: '#34C759',
    fail: '#FF3B30',
  };

  // Add useEffect to fetch data from Supabase
  useEffect(() => {
    const fetchAthleteResults = async () => {
      if (!name) return;

      try {
        setLoading(true);
        const nameStr = Array.isArray(name) ? name[0] : name;
        
        const { data, error } = await supabase
          .from('lifting_results')
          .select('*')
          .eq('name', nameStr)
          .order('date', { ascending: false });

        if (error) {
          console.error('Error fetching athlete results:', error);
          return;
        }

        setAthleteResults(data || []);
      } catch (error) {
        console.error('Error in fetchAthleteResults:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAthleteResults();
  }, [name]);

  if (!name) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText>No athlete selected</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: name?.toString() || 'Meet Results',
          headerBackTitle: 'Back',
          headerTitleStyle: { color: colors.text },
          headerTintColor: '#007AFF',
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          animation: 'slide_from_right',
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerShadowVisible: false,
        }}
      />

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 20 }
        ]}
      >
        {loading ? (
          <View style={[styles.card, { backgroundColor: colors.card, marginTop: 16 }]}>
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.secondaryText} />
            </View>
          </View>
        ) : athleteResults.length === 0 ? (
          <View style={[styles.card, { backgroundColor: colors.card, marginTop: 16 }]}>
            <View style={styles.emptyStateContainer}>
              <ThemedText style={[styles.emptyStateText, { color: colors.secondaryText }]}>
                No meet results found for {name}
              </ThemedText>
            </View>
          </View>
        ) : (
          athleteResults.map((result) => (
            <View 
              key={`${result.meet}-${result.date}`}
              style={[
                styles.card,
                { backgroundColor: colors.card },
                athleteResults.indexOf(result) === 0 && { marginTop: 16 }
              ]}
            >
              <View style={[styles.section, { borderBottomColor: colors.border }]}>
                <ThemedText style={styles.meetName}>{result.meet}</ThemedText>
                <ThemedText style={[styles.meetDate, { color: colors.secondaryText }]}>
                  Date: {new Date(result.date).toLocaleDateString()}
                </ThemedText>
                <ThemedText style={[styles.weightClass, { color: colors.secondaryText }]}>
                  Bodyweight: {result.body_weight?.toFixed(1) ?? '—'} kg
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
                  {result.snatch_best ?? '—'}/{result.cj_best ?? '—'}/{result.total ?? '—'}
                </ThemedText>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </ThemedView>
  );
}

function AttemptDisplay({ attempt, colors }: { attempt: number | null, colors: any }) {
  if (attempt === null || attempt === 0) {
    return <ThemedText style={[styles.attempt, { color: colors.secondaryText }]}>—</ThemedText>;
  }

  const isSuccess = attempt > 0;
  return (
    <ThemedText style={[
      styles.attempt,
      { color: isSuccess ? colors.success : colors.fail }
    ]}>
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
    overflow: 'hidden',
  },
  section: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  meetName: {
    fontSize: 20,
    fontWeight: '600',
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  liftName: {
    fontSize: 16,
    fontWeight: '500',
    minWidth: 100,
  },
  attempts: {
    flexDirection: 'row',
    gap: 24,
    flex: 1,
    justifyContent: 'flex-end',
  },
  attempt: {
    fontSize: 16,
    fontWeight: '600',
    minWidth: 50,
    textAlign: 'center',
  },
  bestLift: {
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
  },
  total: {
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyStateContainer: {
    padding: 20,
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: 15,
    textAlign: 'center',
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
}); 