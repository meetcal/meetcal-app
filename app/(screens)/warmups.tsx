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
import { useUser } from '@clerk/clerk-expo'
import { useFocusEffect } from '@react-navigation/native'
import { supabase } from '@/lib/supabase'

const getSavedWarmupsKey = (userId: string) => `@saved_warmups_${userId}`;

interface AthleteWarmup {
  id: string;
  name: string; // This is saved_warmups.name (which should match an athlete's name)
  lastModified: string;
  meet: string;
  session_number?: number; // To hold athlete session number
}

export default function WarmupsScreen() {
  const { user } = useUser();
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

  useFocusEffect(
    useCallback(() => {
      if (user?.id) {
        loadSavedWarmups();
      }
    }, [user?.id, selectedMeet])
  );

  useEffect(() => {
    console.log('Effect triggered - User ID:', user?.id, 'Selected Meet:', selectedMeet);
    if (user?.id) {
      loadSavedWarmups();
      
      // Check if warmups were reset from info screen
      const checkReset = async () => {
        try {
          const resetTimestamp = await AsyncStorage.getItem(`@warmups_reset_${user.id}`);
          if (resetTimestamp) {
            // Clear the reset flag
            await AsyncStorage.removeItem(`@warmups_reset_${user.id}`);
            // Reload warmups
            loadSavedWarmups();
          }
        } catch (error) {
          console.error('Error checking warmups reset:', error);
        }
      };
      
      checkReset();
    }
  }, [selectedMeet, user?.id])

  const loadSavedWarmups = async () => {
    if (!user?.id) {
      console.log('No user ID, clearing warmups');
      setSavedWarmups([]); // Clear warmups if no user
      return;
    }
    
    try {
      console.log('Loading warmups for user:', user.id, 'Meet:', selectedMeet);
      const key = getSavedWarmupsKey(user.id);

      // --- Fetch from Supabase --- 
      let savedWarmupsQuery = supabase
        .from('saved_warmups')
        .select('id, name, meet, updated_at') 
        .eq('user_id', user.id);

      if (selectedMeet) {
        savedWarmupsQuery = savedWarmupsQuery.eq('meet', selectedMeet);
      }

      const { data: supabaseWarmups, error: supabaseError } = await savedWarmupsQuery;

      if (supabaseError) {
        console.error('Error fetching warmups from Supabase:', supabaseError);
        // Fallback to local storage
        const storedWarmups = await AsyncStorage.getItem(key);
        if (storedWarmups) {
          const allWarmups = JSON.parse(storedWarmups);
          let filteredWarmups = selectedMeet
            ? allWarmups.filter((warmup: any) => warmup.meet === selectedMeet)
            : allWarmups;
          
          let mappedWarmups = filteredWarmups.map((w: any) => ({
            id: w.id,
            name: w.name,
            meet: w.meet,
            lastModified: w.lastModified || new Date().toISOString(),
            session_number: undefined // No session number from AsyncStorage directly
          }));

          mappedWarmups.sort((a: AthleteWarmup, b: AthleteWarmup) => {
            const sessionA = a.session_number ?? Infinity;
            const sessionB = b.session_number ?? Infinity;
            if (sessionA === sessionB) {
                return a.name.localeCompare(b.name);
            }
            return sessionA - sessionB;
          });
          setSavedWarmups(mappedWarmups);
        } else {
          setSavedWarmups([]);
        }
      } else if (supabaseWarmups) {
        console.log('Supabase warmups fetched:', supabaseWarmups);

        if (supabaseWarmups.length === 0) {
          setSavedWarmups([]);
          return;
        }

        // Extract unique athlete names from the fetched warmups
        const athleteNames = [...new Set(supabaseWarmups.map(w => w.name).filter(name => name != null))] as string[];

        let athleteSessionMap = new Map<string, number>();

        if (athleteNames.length > 0) {
          const { data: athletesData, error: athletesError } = await supabase
            .from('athletes')
            .select('name, session_number')
            .in('name', athleteNames);

          if (athletesError) {
            console.error('Error fetching athletes data from Supabase:', athletesError);
            // Proceed without session numbers, or handle error differently
          } else if (athletesData) {
            athletesData.forEach((athlete: { name: string; session_number: number | null }) => {
              if (athlete.name && typeof athlete.session_number === 'number') {
                athleteSessionMap.set(athlete.name, athlete.session_number);
              }
            });
          }
        }
        
        let combinedWarmups = supabaseWarmups.map(w => ({
          id: w.id,
          name: w.name,
          meet: w.meet,
          lastModified: w.updated_at || new Date().toISOString(),
          session_number: athleteSessionMap.get(w.name) // Get session number from the map
        }));

        combinedWarmups.sort((a, b) => {
          const sessionA = a.session_number ?? Infinity;
          const sessionB = b.session_number ?? Infinity;
          if (sessionA === sessionB) {
            return a.name.localeCompare(b.name);
          }
          return sessionA - sessionB;
        });

        setSavedWarmups(combinedWarmups);
      } else {
        console.log('No warmups found in Supabase for this filter');
        setSavedWarmups([]);
      }
    } catch (error) {
      console.error('Error loading warmups:', error);
      setSavedWarmups([]);
    }
  };

  const onRefresh = useCallback(async () => {
    if (!user?.id) return;
    setRefreshing(true)
    await loadSavedWarmups()
    setRefreshing(false)
  }, [selectedMeet, user?.id])

  const deleteWarmup = async (id: string) => {
    if (!user?.id) return;
    
    try {
      const key = getSavedWarmupsKey(user.id);
      
      // 1. Update local state optimistically 
      const previousWarmups = savedWarmups;
      setSavedWarmups(prevWarmups => prevWarmups.filter(warmup => warmup.id !== id));

      // 2. Delete from AsyncStorage (update the whole list)
      const storedWarmups = await AsyncStorage.getItem(key)
      const allWarmups = storedWarmups ? JSON.parse(storedWarmups) : []
      const updatedWarmups = allWarmups.filter((warmup: AthleteWarmup) => warmup.id !== id)
      await AsyncStorage.setItem(key, JSON.stringify(updatedWarmups))
      console.log('Warmup deleted locally');

      // 3. Delete from Supabase
      const { error: supabaseError } = await supabase
        .from('saved_warmups')
        .delete()
        .match({ id: id, user_id: user.id });

      if (supabaseError) {
        console.error('Error deleting warmup from Supabase:', supabaseError);
        // Revert local state if Supabase delete failed
        setSavedWarmups(previousWarmups);
        // Optionally show an error message
      } else {
        console.log('Warmup deleted from Supabase');
      }
      
    } catch (error) {
      console.error('Error deleting warmup:', error)
      // Potentially revert local state if AsyncStorage failed before Supabase call
    }
  };

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
          headerTintColor: colors.text,
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
                      onPress={() => {
                        const allWarmupIds = savedWarmups.map(w => w.id);
                        router.push({
                          pathname: '/(screens)/warmup-details', // Ensure this path is correct for your project structure
                          params: { 
                            id: warmup.id,
                            allWarmupIds: JSON.stringify(allWarmupIds),
                            currentIndex: index.toString()
                          }
                        });
                      }}
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