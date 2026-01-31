import { StyleSheet, View, Linking, Pressable, Platform, ScrollView, Alert, ActivityIndicator, Modal } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { useTheme } from '@/contexts/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSelectedMeet } from '@/contexts/SelectedMeetContext';
import { MeetName } from '@/data/types/meet';
import { useClerk, useAuth, useUser } from '@clerk/clerk-expo';
import { supabase } from '@/lib/supabase';

// Function to get user-specific storage key
const getSavedSessionsKey = (userId: string) => `@saved_sessions_${userId}`;
const getSavedWarmupsKey = (userId: string) => `@saved_warmups_${userId}`;

export default function InfoScreen() {
  const { currentTheme } = useTheme();
  const { signOut } = useClerk();
  const { isSignedIn } = useAuth();
  const { selectedMeet, setSelectedMeet, isLoading } = useSelectedMeet();
  const [showMeetModal, setShowMeetModal] = useState(false);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useUser();


  // Define theme colors
  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
    link: '#007AFF', // iOS blue stays the same in both modes
  };

  const handlePress = (url: string) => {
    Linking.openURL(url);
  };

  const handleAddressPress = () => {
    const address = "400 N High St, Columbus, OH 43215";
    const encodedAddress = encodeURIComponent(address);
    
    // Different URL schemes for iOS and Android
    const mapsUrl = Platform.select({
      ios: `maps://maps.apple.com/?address=${encodedAddress}`,
      android: `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`,
      default: `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`,
    });

    Linking.canOpenURL(mapsUrl).then((supported) => {
      if (supported) {
        Linking.openURL(mapsUrl);
      } else {
        // Fallback to browser if maps app cannot be opened
        Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodedAddress}`);
      }
    });
  };


  const handleResetWarmups = () => {
    if (!user?.id) return;
    
    Alert.alert(
      'Reset Saved Warmups',
      'Are you sure you want to reset all saved warmups? This cannot be undone.',
      [
        {
          text: 'Cancel',
          style: 'cancel'
        },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              // Clear warmups using all possible storage keys, but only for the selected meet
              const STORAGE_KEYS = [
                getSavedWarmupsKey(user.id),
                `@saved_warmups_${user.id}`,
                `@saved_warmups`,
                `warmups_${user.id}`,
                `@warmups_${user.id}`
              ];
              for (const key of STORAGE_KEYS) {
                const stored = await AsyncStorage.getItem(key);
                if (stored) {
                  let warmups = [];
                  try { warmups = JSON.parse(stored); } catch {}
                  if (Array.isArray(warmups)) {
                    const filtered = warmups.filter(w => w.meet !== selectedMeet);
                    await AsyncStorage.setItem(key, JSON.stringify(filtered));
                  }
                }
              }
              // Delete from Supabase for this user and meet only
              if (selectedMeet) {
                const { error: supabaseError } = await supabase
                  .from('saved_warmups')
                  .delete()
                  .match({ user_id: user.id, meet: selectedMeet });
                if (supabaseError) {
                  console.error('Error deleting warmups from Supabase:', supabaseError);
                }
              }
              // Set flags to notify both screens that data was reset
              await AsyncStorage.setItem(`@warmups_reset_${user.id}`, Date.now().toString());
              await AsyncStorage.setItem(`@saved_warmups_reset_${user.id}`, Date.now().toString());
              // Show success message
              Alert.alert('Success', 'All saved warmups for this meet have been reset.');
            } catch (error) {
              console.error('Error resetting warmups:', error);
              Alert.alert('Error', 'Failed to reset warmups.');
            }
          }
        }
      ]
    );
  };

  const handleMeetSelect = async (meet: MeetName) => {
    setShowMeetModal(false); // Close modal immediately
    try {
      await setSelectedMeet(meet);
    } catch (error) {
      console.error('Error saving selected meet:', error);
      // Show error alert if meet selection fails
      Alert.alert('Error', 'Failed to update selected meet.');
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      // The auth layout will automatically redirect to sign-in
    } catch (err) {
      console.error('Error signing out:', err);
      Alert.alert('Error', 'Failed to sign out. Please try again.');
    }
  };

  const handleAuthAction = () => {
    if (isSignedIn) {
      handleSignOut();
    } else {
      router.push({
        pathname: '/(auth)/sign-in',
        params: { from: 'info' }
      });
    }
  };

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen 
        options={{
          headerTitle: 'Info',
          headerTitleStyle: {
            color: colors.text,
          },
          headerStyle: {
            backgroundColor: currentTheme === 'dark' ? '#000000' : '#FFFFFF',  // White in light mode, dark gray in dark mode
          },
          headerShadowVisible: false,
        }}
      />

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { 
            paddingHorizontal: 20, 
            paddingTop: 20,
            paddingBottom: Math.max(80, insets.bottom + 60)
          }
        ]}
        showsVerticalScrollIndicator={false}
      >

        <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => {
              if (isSignedIn) {
                router.push('/(screens)/profile');
              } else {
                router.push({
                  pathname: '/(auth)/sign-in',
                  params: { from: 'info' }
                });
              }
            }}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                {isSignedIn ? 'My Profile & Settings' : 'Sign In To Your Account'}
              </ThemedText>
              <IconSymbol 
                name={Platform.OS === 'ios' ? 'chevron.right' : 'chevron-forward'}
                size={20} 
                color={colors.link} 
              />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/event-info')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Event Info
              </ThemedText>
              <IconSymbol
                name={Platform.OS === 'ios' ? 'chevron.right' : 'chevron-forward'}
                size={20}
                color={colors.link}
              />
            </View>
          </Pressable>

          {/* <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/weightlifting-wrapped')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Weightlifting Wrapped
              </ThemedText>
              <IconSymbol
                name={Platform.OS === 'ios' ? 'chevron.right' : 'chevron-forward'}
                size={20}
                color={colors.link}
              />
            </View>
          </Pressable> */}

          <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/offline-data')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Offline Data
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              styles.lastSection,
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/share-results-by-club')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Shareable Meet Results By Club
              </ThemedText>
              <IconSymbol
                name={Platform.OS === 'ios' ? 'chevron.right' : 'chevron-forward'}
                size={20}
                color={colors.link}
              />
            </View>
          </Pressable>
        </View>

        <ThemedText style={[styles.sectionHeader, { color: colors.secondaryText }]}>
          National
        </ThemedText>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/adap-records')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Adaptive American Records
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/all-meet-results')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                All Meet Results
              </ThemedText>
              <IconSymbol
                name={Platform.OS === 'ios' ? 'chevron.right' : 'chevron-forward'}
                size={20}
                color={colors.link}
              />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/national-rankings')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                National Rankings
              </ThemedText>
              <IconSymbol
                name={Platform.OS === 'ios' ? 'chevron.right' : 'chevron-forward'}
                size={20}
                color={colors.link}
              />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/records')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                National & World Records
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/wso-records')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                WSO Records
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              styles.lastSection,
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/new-qualifying-totals')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Qualifying Totals
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>
        </View>

        <ThemedText style={[styles.sectionHeader, { color: colors.secondaryText }]}>
          International
        </ThemedText>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/new-standards')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                A/B Standards
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              styles.lastSection,
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/rankings')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                International Rankings
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>
        </View>
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
  },
  card: {
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  sectionHeader: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 8,
  },
  section: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lastSection: {
    borderBottomWidth: 0,
  },
  sectionPressed: {
    backgroundColor: '#F5F5F5',
  },
  label: {
    fontSize: 16,
    marginBottom: 4,
  },
  value: {
    fontSize: 16,
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  link: {
    fontSize: 17,
    lineHeight: 22,
  },
  addressContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 4,
  },
  sectionText: {
    fontSize: 16,
  },
  subscriptionContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  subscriptionInfo: {
    flex: 1,
    marginRight: 16,
  },
  subscriptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  subscriptionPreview: {
    fontSize: 16,
    lineHeight: 21,
  },
  dangerZone: {
    marginTop: 8,
    alignItems: 'center',
  },
  resetButton: {
    backgroundColor: '#FF3B30', // iOS red
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  resetButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  loadingContainer: {
    alignItems: 'center',
  },
  profileContent: {
    paddingVertical: 4,
  },
  profileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  profileValue: {
    fontSize: 16,
  },
  copyright: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  meetValue: {
    fontSize: 15,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
    marginHorizontal: 16,
  },
  modalHeader: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    position: 'relative',
  },
  closeButton: {
    position: 'absolute',
    right: 16,
    top: 16,
    padding: 4,
    zIndex: 1,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalOptionText: {
    fontSize: 17,
  },
}); 
