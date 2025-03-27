import { StyleSheet, View, TextInput, ScrollView, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native'
import { ThemedView } from '@/components/ThemedView'
import { ThemedText } from '@/components/ThemedText'
import { Stack, useRouter } from 'expo-router'
import { useTheme } from '@/contexts/ThemeContext'
import { useState, useEffect } from 'react'
import { useSelectedMeet } from '@/contexts/SelectedMeetContext'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'
import { IconSymbol } from '@/components/ui/IconSymbol'
import debounce from 'lodash/debounce'

interface WarmupRow {
  minutesOut: string | number
  snatch: string | number
  cleanAndJerk: string | number
}

interface SearchResult {
  name: string
  club: string
  snatch_best: number
  cj_best: number
}

interface AthleteInfo {
  name: string
  club: string
  snatchPR: number
  cleanAndJerkPR: number
}

export default function CreateWarmupScreen() {
  const { currentTheme } = useTheme()
  const { selectedMeet } = useSelectedMeet()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedAthlete, setSelectedAthlete] = useState<AthleteInfo | null>(null)
  const [warmupRows, setWarmupRows] = useState<WarmupRow[]>(
    Array.from({ length: 13 }, (_, i) => ({
      minutesOut: i < 3 ? 3 - i : (i - 2) * 3,
      snatch: '',
      cleanAndJerk: '',
    }))
  )
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [showResults, setShowResults] = useState(false)

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

  const handleSave = async () => {
    if (!selectedAthlete) return

    try {
      // Get existing warmups
      const existingWarmupsStr = await AsyncStorage.getItem('@saved_warmups')
      const existingWarmups = existingWarmupsStr ? JSON.parse(existingWarmupsStr) : []

      // Create new warmup
      const newWarmup = {
        id: Date.now().toString(),
        name: selectedAthlete.name,
        lastModified: new Date().toISOString(),
        athlete: selectedAthlete,
        warmupRows: warmupRows,
        meet: selectedMeet
      }

      // Add to existing warmups
      const updatedWarmups = [...existingWarmups, newWarmup]
      await AsyncStorage.setItem('@saved_warmups', JSON.stringify(updatedWarmups))

      // Navigate back
      router.back()
    } catch (error) {
      console.error('Error saving warmup:', error)
    }
  }

  // Debounced search function
  const searchAthletes = debounce(async (query: string) => {
    if (!query.trim() || query.trim().length < 3) {
      setSearchResults([])
      setShowResults(false)
      return
    }

    setIsSearching(true)
    try {
      // First get athletes matching the name
      const { data: athletes, error: athletesError } = await supabase
        .from('athletes')
        .select('name, club')
        .eq('meet', selectedMeet)
        .ilike('name', `%${query}%`)
        .limit(5)

      if (athletesError) throw athletesError
      if (!athletes || athletes.length === 0) {
        setSearchResults([])
        setShowResults(false)
        return
      }

      // Get PRs for each athlete
      const athleteResults = await Promise.all(
        athletes.map(async (athlete) => {
          // Get max values for snatch and clean & jerk
          const { data: prs, error: prsError } = await supabase
            .from('lifting_results')
            .select(`
              snatch_best,
              cj_best
            `)
            .eq('name', athlete.name)
            .not('snatch_best', 'is', null)
            .not('cj_best', 'is', null)
            .order('snatch_best', { ascending: false })
            .order('cj_best', { ascending: false })
            .limit(1)

          if (prsError) {
            console.error('Error fetching PRs:', prsError)
            return {
              ...athlete,
              snatch_best: 0,
              cj_best: 0,
            }
          }

          // Get the highest values
          const bestLifts = prs?.[0] || { snatch_best: 0, cj_best: 0 }

          return {
            ...athlete,
            snatch_best: bestLifts.snatch_best,
            cj_best: bestLifts.cj_best,
          }
        })
      )

      setSearchResults(athleteResults)
      setShowResults(true)
    } catch (error) {
      console.error('Error searching athletes:', error)
    } finally {
      setIsSearching(false)
    }
  }, 300)

  const handleAthleteSelect = (athlete: SearchResult) => {
    setSelectedAthlete({
      name: athlete.name,
      club: athlete.club,
      snatchPR: athlete.snatch_best,
      cleanAndJerkPR: athlete.cj_best,
    })
    setSearchQuery(athlete.name)
    setShowResults(false)
  }

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

  useEffect(() => {
    searchAthletes(searchQuery)
  }, [searchQuery])

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: 'Create Warmup',
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
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            {/* Search Bar */}
            <View style={[styles.searchContainer, { backgroundColor: colors.searchBackground }]}>
              <View style={styles.searchInputContainer}>
                <IconSymbol name="magnifyingglass" size={20} color={colors.secondaryText} />
                <TextInput
                  style={[styles.searchInput, { color: colors.text }]}
                  placeholder="Search Athlete Name"
                  placeholderTextColor={colors.secondaryText}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
                {isSearching && <ActivityIndicator size="small" color={colors.secondaryText} />}
              </View>

              {/* Search Results */}
              {showResults && searchResults.length > 0 && (
                <View style={[styles.searchResults, { borderTopColor: colors.border }]}>
                  {searchResults.map((result) => (
                    <Pressable
                      key={result.name}
                      style={({ pressed }) => [
                        styles.resultItem,
                        pressed && { backgroundColor: colors.pressed }
                      ]}
                      onPress={() => handleAthleteSelect(result)}
                    >
                      <ThemedText style={[styles.resultName, { color: colors.text }]}>
                        {result.name}
                      </ThemedText>
                      <ThemedText style={[styles.resultClub, { color: colors.secondaryText }]}>
                        {result.club}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            {/* Club Info */}
            <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
              <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
                Club
              </ThemedText>
              <ThemedText style={[styles.value, { color: colors.text }]}>
                {selectedAthlete?.club || '—'}
              </ThemedText>
            </View>

            {/* PRs */}
            <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
              <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
                Snatch PR
              </ThemedText>
              <ThemedText style={[styles.value, { color: colors.text }]}>
                {selectedAthlete?.snatchPR || '—'}
              </ThemedText>
            </View>
            <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
              <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
                Clean & Jerk PR
              </ThemedText>
              <ThemedText style={[styles.value, { color: colors.text }]}>
                {selectedAthlete?.cleanAndJerkPR || '—'}
              </ThemedText>
            </View>

            {/* Meet Results Link */}
            {selectedAthlete && (
              <Pressable
                style={({ pressed }) => [
                  styles.meetResultsButton,
                  { borderTopColor: colors.border },
                  pressed && { backgroundColor: colors.pressed }
                ]}
                onPress={() => router.push({
                  pathname: '/athlete-results',
                  params: { name: selectedAthlete.name }
                })}
              >
                <View style={styles.meetResultsContent}>
                  <ThemedText style={[styles.meetResultsText, { color: colors.link }]}>
                    See All Meet Results
                  </ThemedText>
                  <IconSymbol name="chevron.right" size={20} color={colors.link} />
                </View>
              </Pressable>
            )}
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
        </ScrollView>

        {/* Save Button - Fixed to bottom */}
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
            style={[
              styles.saveButton,
              { 
                backgroundColor: selectedAthlete ? colors.link : colors.secondaryText,
                opacity: selectedAthlete ? 1 : 0.5 
              }
            ]}
            onPress={handleSave}
            disabled={!selectedAthlete}
          >
            <ThemedText style={styles.saveButtonText}>
              Save Warmup
            </ThemedText>
          </Pressable>
        </View>
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
  searchContainer: {
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
  },
  searchInput: {
    fontSize: 17,
    padding: 8,
    borderRadius: 8,
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
  searchResults: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
  },
  resultItem: {
    padding: 12,
  },
  resultName: {
    fontSize: 17,
    fontWeight: '500',
    marginBottom: 2,
  },
  resultClub: {
    fontSize: 14,
  },
  meetResultsButton: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  meetResultsContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  meetResultsText: {
    fontSize: 17,
    fontWeight: '500',
  },
}) 