import React from 'react'
import { StyleSheet, View, ScrollView, TextInput, Pressable } from 'react-native'
import { ThemedView } from '@/components/ThemedView'
import { ThemedText } from '@/components/ThemedText'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useTheme } from '@/contexts/ThemeContext'
import { useState, useEffect } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { IconSymbol } from '@/components/ui/IconSymbol'

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
    loadWarmup()
  }, [id])

  const loadWarmup = async () => {
    try {
      const savedWarmups = await AsyncStorage.getItem('@saved_warmups')
      if (savedWarmups) {
        const warmups = JSON.parse(savedWarmups)
        const selectedWarmup = warmups.find((w: SavedWarmup) => w.id === id)
        if (selectedWarmup) {
          setWarmup(selectedWarmup)
          setWarmupRows(selectedWarmup.warmupRows)
        }
      }
    } catch (error) {
      console.error('Error loading warmup:', error)
    }
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

  const handleSave = async () => {
    if (!warmup) return

    try {
      const savedWarmups = await AsyncStorage.getItem('@saved_warmups')
      if (savedWarmups) {
        const warmups = JSON.parse(savedWarmups)
        const updatedWarmups = warmups.map((w: SavedWarmup) => {
          if (w.id === id) {
            return {
              ...w,
              warmupRows,
              lastModified: new Date().toISOString()
            }
          }
          return w
        })
        await AsyncStorage.setItem('@saved_warmups', JSON.stringify(updatedWarmups))
        router.back()
      }
    } catch (error) {
      console.error('Error saving warmup:', error)
    }
  }

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

      <ScrollView 
        style={styles.scrollView} 
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 100 }
        ]}
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

            {/* Save Button */}
            <View style={[styles.saveButtonContainer, { marginTop: 24 }]}>
              <Pressable
                style={[styles.saveButton, { backgroundColor: colors.link }]}
                onPress={handleSave}
              >
                <ThemedText style={styles.saveButtonText}>
                  Save Changes
                </ThemedText>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
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
  },
  saveButton: {
    borderRadius: 12,
    padding: 16,
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