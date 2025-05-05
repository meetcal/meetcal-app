import React from 'react'
import { StyleSheet, View, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform } from 'react-native'
import { ThemedView } from '@/components/ThemedView'
import { ThemedText } from '@/components/ThemedText'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useTheme } from '@/contexts/ThemeContext'
import { useState, useEffect } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { IconSymbol } from '@/components/ui/IconSymbol'
import { useUser } from '@clerk/clerk-expo'
import { supabase } from '@/lib/supabase'

// Update storage key to be user-specific
const getSavedWarmupsKey = (userId: string) => `@saved_warmups_${userId}`;

interface WarmupRow {
  minutesOut: string | number
  snatch: string | number
  cleanAndJerk: string | number
}

interface AthleteInfo {
  name: string
  club: string
  snatchPR: number
  cleanAndJerkPR: number
}

interface SavedWarmup {
  id: string
  name: string
  lastModified: string
  athlete: AthleteInfo
  warmupRows: WarmupRow[]
  meet: string
}

export default function WarmupDetailsScreen() {
  const { user } = useUser();
  const { currentTheme } = useTheme()
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [warmup, setWarmup] = useState<SavedWarmup | null>(null)
  const [warmupRows, setWarmupRows] = useState<WarmupRow[]>([])

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    searchBackground: currentTheme === 'dark' ? '#1C1C1E' : '#EFEFF4',
    link: currentTheme === 'dark' ? '#007AFF' : '#007AFF',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
    highlight: currentTheme === 'dark' ? 'rgba(0, 122, 255, 0.1)' : 'rgba(0, 122, 255, 0.1)',
  }

  useEffect(() => {
    if (user?.id) {
      loadWarmup()
    }
  }, [id, user?.id])

  const loadWarmup = async () => {
    if (!user?.id || !id) {
        console.log('User ID or Warmup ID missing');
        setWarmup(null); // Clear warmup if IDs are missing
        setWarmupRows([]);
        return;
    }
    
    try {
      console.log('Loading warmup details for ID:', id, 'User:', user.id);

      // --- Try fetching from Supabase first ---
      const { data: supabaseData, error: supabaseError } = await supabase
        .from('saved_warmups')
        .select('id, name, meet, warmup_data, updated_at') // Select all necessary fields
        .eq('id', id)
        .eq('user_id', user.id)
        .single(); // Expecting a single result

      if (supabaseError && supabaseError.code !== 'PGRST116') { // Ignore 'No rows found' error initially
        console.error('Error fetching warmup from Supabase:', supabaseError);
        // Fallback to AsyncStorage below
      } else if (supabaseData && Array.isArray(supabaseData) && supabaseData.length > 0) {
        // Access the first element since the response is an array
        const warmupRecord = supabaseData[0]; 
        
        let parsedWarmupData: { athlete: AthleteInfo; warmupRows: WarmupRow[] } | null = null;

        try {
          // Use warmupRecord instead of supabaseData
          if (typeof warmupRecord.warmup_data === 'string') {
            parsedWarmupData = JSON.parse(warmupRecord.warmup_data);
          } else if (typeof warmupRecord.warmup_data === 'object' && warmupRecord.warmup_data !== null) {
            // Assume it's already an object
            parsedWarmupData = warmupRecord.warmup_data as { athlete: AthleteInfo; warmupRows: WarmupRow[] };
          }
        } catch (error) {
          console.error('Error parsing warmup_data:', error);
        }

        if (parsedWarmupData) {
          const loadedWarmup: SavedWarmup = {
            id: warmupRecord.id,
            name: warmupRecord.name,
            meet: warmupRecord.meet,
            lastModified: warmupRecord.updated_at || new Date().toISOString(),
            athlete: parsedWarmupData.athlete,
            warmupRows: parsedWarmupData.warmupRows || []
          };
          setWarmup(loadedWarmup);
          setWarmupRows(loadedWarmup.warmupRows);

          // Optionally update AsyncStorage here if needed for offline consistency
          // This would involve fetching the full list, updating this item, and saving back

          return; // Successfully loaded from Supabase
        } else {
            console.error('Supabase warmup_data processing failed. Data received:', JSON.stringify(warmupRecord?.warmup_data)); 
            // Fallback to AsyncStorage
        }
      } else {
        // Handle case where supabaseData is null, not an array, or empty
        console.log('[WarmupDetails] No valid data returned from Supabase query despite no error.');
        // Fallback to AsyncStorage
        console.log('Falling back to loading warmup from AsyncStorage');
        const key = getSavedWarmupsKey(user.id);
        const savedWarmups = await AsyncStorage.getItem(key);
        if (savedWarmups) {
          const warmups = JSON.parse(savedWarmups);
          const selectedWarmup = warmups.find((w: SavedWarmup) => w.id === id);
          if (selectedWarmup) {
            setWarmup(selectedWarmup);
            setWarmupRows(selectedWarmup.warmupRows || []); // Ensure warmupRows is always an array
          }
        } else {
          console.log('Warmup not found in AsyncStorage either');
          setWarmup(null);
          setWarmupRows([]);
        }
      }
    } catch (error) {
      console.error('Error loading warmup:', error);
      setWarmup(null);
      setWarmupRows([]);
    }
  };

  const handleMinutesOutChange = (index: number, value: string) => {
    const newRows = [...warmupRows]
    const parsedValue = parseInt(value, 10)
    newRows[index] = {
      ...newRows[index],
      minutesOut: value === '' || isNaN(parsedValue) ? '' : parsedValue
    }
    setWarmupRows(newRows)
  }

  const handleSnatchChange = (index: number, value: string) => {
    const newRows = [...warmupRows]
    const parsedValue = parseInt(value, 10)
    newRows[index] = {
      ...newRows[index],
      snatch: value === '' || isNaN(parsedValue) ? '' : parsedValue
    }
    setWarmupRows(newRows)
  }

  const handleCleanAndJerkChange = (index: number, value: string) => {
    const newRows = [...warmupRows]
    const parsedValue = parseInt(value, 10)
    newRows[index] = {
      ...newRows[index],
      cleanAndJerk: value === '' || isNaN(parsedValue) ? '' : parsedValue
    }
    setWarmupRows(newRows)
  }

  const handleSave = async () => {
    if (!warmup || !user?.id) return

    try {
      const key = getSavedWarmupsKey(user.id);
      const updatedTimestamp = new Date().toISOString();

      // 1. Update AsyncStorage
      const savedWarmups = await AsyncStorage.getItem(key)
      let updatedWarmupsLocal: SavedWarmup[] = [];
      if (savedWarmups) {
        const warmups = JSON.parse(savedWarmups)
        updatedWarmupsLocal = warmups.map((w: SavedWarmup) => {
          if (w.id === id) {
            return {
              ...w,
              warmupRows, // Use the updated rows from state
              lastModified: updatedTimestamp
            }
          }
          return w
        })
        await AsyncStorage.setItem(key, JSON.stringify(updatedWarmupsLocal))
        console.log('Warmup updated locally in AsyncStorage');
      } else {
        console.warn('Could not find warmup list in AsyncStorage to update.')
        // Decide how to handle this - maybe save the single item?
      }

      // 2. Update Supabase
      const updatedWarmupDataForSupabase = {
        athlete: warmup.athlete, // Keep original athlete info
        warmupRows: warmupRows // Send the updated rows
      };

      const { error: supabaseError } = await supabase
        .from('saved_warmups')
        .update({
          warmup_data: updatedWarmupDataForSupabase,
          updated_at: updatedTimestamp // Explicitly set updated_at
        })
        .match({ id: id, user_id: user.id });

      if (supabaseError) {
        console.error('Error updating warmup in Supabase:', supabaseError);
        // Handle error - revert local changes? Show message?
      } else {
        console.log('Warmup updated in Supabase successfully');
      }
      
      // Navigate back after attempts
      router.back()
    } catch (error) {
      console.error('Error saving warmup changes:', error)
    }
  };

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: warmup?.athlete.name || 'Warmup Details',
          headerBackTitle: 'Back',
          headerTitleStyle: {
            color: colors.text,
          },
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

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        <ScrollView 
          style={styles.scrollView} 
          contentContainerStyle={[
            styles.content,
            { paddingBottom: 32 }
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={true}
        >
          {warmup && (
            <>
              <View style={[styles.card, { backgroundColor: colors.card }]}>
                {/* Athlete Info */}
                <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
                  <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
                    Club
                  </ThemedText>
                  <ThemedText style={[styles.value, { color: colors.text }]}>
                    {warmup.athlete.club}
                  </ThemedText>
                </View>

                {/* PRs */}
                <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
                  <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
                    Snatch PR
                  </ThemedText>
                  <ThemedText style={[styles.value, { color: colors.text }]}>
                    {warmup.athlete.snatchPR}
                  </ThemedText>
                </View>
                <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
                  <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
                    Clean & Jerk PR
                  </ThemedText>
                  <ThemedText style={[styles.value, { color: colors.text }]}>
                    {warmup.athlete.cleanAndJerkPR}
                  </ThemedText>
                </View>

                {/* See All Results Button */}
                <Pressable
                  style={[styles.infoRow, { borderBottomColor: colors.border }]}
                  onPress={() => router.push({
                    pathname: '/athlete-results',
                    params: { name: warmup.athlete.name }
                  })}
                >
                  <ThemedText style={[styles.value, { color: colors.link }]}>
                    See All Meet Results
                  </ThemedText>
                  <IconSymbol name="chevron.right" size={16} color={colors.link} />
                </Pressable>
              </View>

              {/* Warmup Table */}
              <View style={[styles.card, { backgroundColor: colors.card, marginTop: 16 }]}>
                <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
                  <ThemedText style={[styles.headerCell, { color: colors.secondaryText }]}>
                    Minutes Out
                  </ThemedText>
                  <ThemedText style={[styles.headerCell, { color: colors.secondaryText }]}>
                    Snatch
                  </ThemedText>
                  <ThemedText style={[styles.headerCell, { color: colors.secondaryText }]}>
                    C&J
                  </ThemedText>
                </View>

                {warmupRows.map((row, index) => (
                  <View 
                    key={index} 
                    style={[
                      styles.tableRow, 
                      index < warmupRows.length - 1 && { borderBottomColor: colors.border },
                      index < 3 && { backgroundColor: colors.highlight }
                    ]}
                  >
                    <TextInput
                      style={[styles.tableCell, { color: colors.text }]}
                      value={index === 0 ? "3rd" : index === 1 ? "2nd" : index === 2 ? "Opener" : row.minutesOut.toString() === '0' ? '' : row.minutesOut.toString()}
                      editable={index >= 3}
                      keyboardType="numeric"
                      onChangeText={(value) => handleMinutesOutChange(index, value)}
                      placeholder="—"
                      placeholderTextColor={colors.secondaryText}
                    />
                    <TextInput
                      style={[styles.tableCell, { color: colors.text }]}
                      value={row.snatch.toString() === '0' ? '' : row.snatch.toString()}
                      placeholder="—"
                      placeholderTextColor={colors.secondaryText}
                      keyboardType="numeric"
                      onChangeText={(value) => handleSnatchChange(index, value)}
                    />
                    <TextInput
                      style={[styles.tableCell, { color: colors.text }]}
                      value={row.cleanAndJerk.toString() === '0' ? '' : row.cleanAndJerk.toString()}
                      placeholder="—"
                      placeholderTextColor={colors.secondaryText}
                      keyboardType="numeric"
                      onChangeText={(value) => handleCleanAndJerkChange(index, value)}
                    />
                  </View>
                ))}
              </View>
            </>
          )}
        </ScrollView>

        {/* Save Button - Fixed to bottom */}
        {warmup && (
          <View style={[
            styles.saveButtonContainer, 
            { 
              backgroundColor: colors.background,
              paddingBottom: Math.max(insets.bottom, 12),
              paddingTop: 12,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: colors.border
            }
          ]}>
            <Pressable
              style={[styles.saveButton, { backgroundColor: colors.link }]}
              onPress={handleSave}
            >
              <ThemedText style={styles.saveButtonText}>
                Save Changes
              </ThemedText>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  card: {
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: 16,
  },
  value: {
    fontSize: 16,
    fontWeight: '600',
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  headerCell: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableCell: {
    flex: 1,
    padding: 12,
    fontSize: 17,
    textAlign: 'center',
  },
  saveButtonContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 5,
  },
  saveButton: {
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
}) 