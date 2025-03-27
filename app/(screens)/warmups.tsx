import { StyleSheet, View, Pressable, ScrollView, RefreshControl, Animated, KeyboardAvoidingView, Platform } from 'react-native'
import { ThemedText } from '@/components/ThemedText'
import { ThemedView } from '@/components/ThemedView'
import { IconSymbol } from '@/components/ui/IconSymbol'
import { useTheme } from '@/contexts/ThemeContext'
import { Stack, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useState, useEffect, useCallback, useRef } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Swipeable, GestureHandlerRootView } from 'react-native-gesture-handler'
import { useSelectedMeet } from '@/contexts/SelectedMeetContext'

const SAVED_WARMUPS_KEY = '@saved_warmups'

interface AthleteWarmup {
  id: string
  name: string
  lastModified: string
  meet: string
}

export default function WarmupsScreen() {
  const { currentTheme } = useTheme()
  const { selectedMeet } = useSelectedMeet()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [savedWarmups, setSavedWarmups] = useState<AthleteWarmup[]>([])
  const [refreshing, setRefreshing] = useState(false)

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: '2-digit'
    })
  }

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
    link: '#007AFF',
  }

  useEffect(() => {
    loadSavedWarmups()
  }, [selectedMeet])

  const loadSavedWarmups = async () => {
    try {
      const storedWarmups = await AsyncStorage.getItem(SAVED_WARMUPS_KEY)
      if (storedWarmups) {
        const allWarmups = JSON.parse(storedWarmups)
        const meetWarmups = allWarmups.filter((warmup: AthleteWarmup) => warmup.meet === selectedMeet)
        setSavedWarmups(meetWarmups)
      }
    } catch (error) {
      console.error('Error loading warmups:', error)
    }
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await loadSavedWarmups()
    setRefreshing(false)
  }, [selectedMeet])

  const deleteWarmup = async (id: string) => {
    try {
      const updatedWarmups = savedWarmups.filter(warmup => warmup.id !== id)
      await AsyncStorage.setItem(SAVED_WARMUPS_KEY, JSON.stringify(updatedWarmups))
      setSavedWarmups(updatedWarmups)
    } catch (error) {
      console.error('Error deleting warmup:', error)
    }
  }

  const renderRightActions = (progress: Animated.AnimatedInterpolation<number>, dragX: Animated.AnimatedInterpolation<number>, onDelete: () => void) => {
    const trans = dragX.interpolate({
      inputRange: [-100, 0],
      outputRange: [1, 0],
      extrapolate: 'clamp',
    })

    return (
      <Pressable
        onPress={onDelete}
        style={[
          styles.deleteButton,
          {
            backgroundColor: '#FF3B30',
          }
        ]}
      >
        <Animated.View style={[{ transform: [{ translateX: trans }] }]}>
          <IconSymbol name="trash" size={20} color="#FFFFFF" />
        </Animated.View>
      </Pressable>
    )
  }

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: 'Saved Warmups',
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
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
      >
        <GestureHandlerRootView style={{ flex: 1 }}>
          <ScrollView 
            style={[styles.content, { paddingBottom: insets.bottom }]}
            contentContainerStyle={{ gap: 16, padding: 16 }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.text}
                colors={[colors.link]}
              />
            }
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <Pressable
              style={[styles.createButton, { backgroundColor: colors.link }]}
              onPress={() => router.push('/create-warmup')}
            >
              <IconSymbol name="plus" size={20} color="#FFFFFF" />
              <ThemedText style={[styles.createButtonText, { color: '#FFFFFF' }]}>
                Create New Warmup
              </ThemedText>
            </Pressable>

            <View style={[styles.card, { backgroundColor: colors.card }]}>
              {!selectedMeet ? (
                <View style={styles.emptyState}>
                  <ThemedText style={[styles.emptyText, { color: colors.secondaryText }]}>
                    Select a meet to view warmups
                  </ThemedText>
                </View>
              ) : savedWarmups.length === 0 ? (
                <View style={styles.emptyState}>
                  <ThemedText style={[styles.emptyText, { color: colors.secondaryText }]}>
                    No saved warmups for this meet
                  </ThemedText>
                </View>
              ) : (
                savedWarmups.map((warmup, index) => (
                  <Swipeable
                    key={warmup.id}
                    renderRightActions={(progress, dragX) => 
                      renderRightActions(progress, dragX, () => deleteWarmup(warmup.id))
                    }
                    overshootRight={false}
                  >
                    <Pressable
                      style={({ pressed }) => [
                        styles.warmupRow,
                        index !== savedWarmups.length - 1 && { 
                          borderBottomWidth: StyleSheet.hairlineWidth,
                          borderBottomColor: colors.border 
                        },
                        pressed && { backgroundColor: colors.pressed }
                      ]}
                      onPress={() => router.push({
                        pathname: '/warmup-details',
                        params: { id: warmup.id }
                      })}
                    >
                      <View>
                        <ThemedText style={[styles.athleteName, { color: colors.text }]}>
                          {warmup.name}
                        </ThemedText>
                        <ThemedText style={[styles.lastModified, { color: colors.secondaryText }]}>
                          Last modified {formatDate(warmup.lastModified)}
                        </ThemedText>
                      </View>
                      <IconSymbol name="chevron.right" size={20} color={colors.link} />
                    </Pressable>
                  </Swipeable>
                ))
              )}
            </View>
          </ScrollView>
        </GestureHandlerRootView>
      </KeyboardAvoidingView>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 8,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  createButtonText: {
    fontSize: 17,
    fontWeight: '600',
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
  warmupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  athleteName: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 4,
  },
  lastModified: {
    fontSize: 14,
  },
  emptyState: {
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 16,
  },
  deleteButton: {
    width: 80,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
}) 