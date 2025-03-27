import { StyleSheet, View, Linking, Pressable, Platform, ScrollView, Switch, Alert, ActivityIndicator, Modal } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { venueConfig, getFullAddress } from '@/config/venue';
import { useTheme } from '@/contexts/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { useSavedSessions } from '@/contexts/SavedSessionsContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSelectedMeet } from '@/contexts/SelectedMeetContext';
import { MeetName } from '@/data/types/meet';

const showReviewPrompt = () => {
  Alert.alert(
    'Enjoying MeetCal?',
    'Would you like to leave a review? Your feedback helps us improve the app.',
    [
      {
        text: 'Not Now',
        style: 'cancel'
      },
      {
        text: 'Leave Review',
        onPress: () => {
          Linking.openURL('https://apps.apple.com/us/app/meetcal/id6741133286');
        }
      }
    ]
  );
};

export default function InfoScreen() {
  const { currentTheme, setTheme } = useTheme();
  const [isEnabled, setIsEnabled] = useState(currentTheme === 'dark');
  const { selectedMeet, setSelectedMeet, isLoading } = useSelectedMeet();
  const [showMeetModal, setShowMeetModal] = useState(false);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { savedSessions, resetAllSessions } = useSavedSessions();

  // Sync the switch state with theme changes
  useEffect(() => {
    setIsEnabled(currentTheme === 'dark');
  }, [currentTheme]);

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

  const handleThemeChange = (value: boolean) => {
    setIsEnabled(value); // Update switch state immediately
    setTheme(value ? 'dark' : 'light'); // Update theme
  };

  const handleResetSessions = () => {
    Alert.alert(
      'Reset Saved Sessions',
      'Are you sure you want to remove all saved sessions? This cannot be undone.',
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
              // Try to use the context's reset function first
              let success = false;
              if (typeof resetAllSessions === 'function') {
                success = await resetAllSessions();
              }
              
              // Also manually clear all possible storage keys
              const STORAGE_KEYS = [
                '@saved_sessions',
                'savedSessions',
                '@savedSessions',
                'sessions'
              ];
              
              for (const key of STORAGE_KEYS) {
                await AsyncStorage.setItem(key, JSON.stringify([]));
              }
              
              // Set a flag to notify other components that sessions were reset
              await AsyncStorage.setItem('@sessions_reset', Date.now().toString());
              
              // Show success message
              Alert.alert('Success', 'All saved sessions have been reset.');
              
            } catch (error) {
              console.error('Error resetting sessions:', error);
              Alert.alert('Error', 'Failed to reset saved sessions.');
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
        
        {/* Records and Standards */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <ThemedText style={[styles.cardTitle, { color: colors.text }]}>
            Weightlifting Information
          </ThemedText>
          
          <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => setShowMeetModal(true)}
          >
            <View style={styles.linkRow}>
              <View>
                <ThemedText style={[styles.label, { color: colors.text }]}>
                  Select Your Meet
                </ThemedText>
                <ThemedText style={[styles.meetValue, { color: colors.secondaryText }]}>
                  {selectedMeet}
                </ThemedText>
              </View>
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

          <Pressable
            style={({ pressed }) => [
              styles.section,
              styles.lastSection,
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/records-and-standards')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Totals, Standards, & Records
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>
        </View>

        {/* App Info */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <ThemedText style={[styles.cardTitle, { color: colors.text }]}>
            App Information
          </ThemedText>
          
          <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push({
              pathname: '/(screens)/subscription',
              params: { from: 'info' }
            })}
          >
            <View style={styles.subscriptionContainer}>
              <View style={styles.subscriptionInfo}>
                <ThemedText style={[styles.label, { color: colors.text }]}>
                  Manage Subscription
                </ThemedText>
              </View>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/feedback')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Submit Feedback
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
            onPress={() => handlePress('https://apps.apple.com/us/app/meetcal/id6741133286')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Leave a Review
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
          >
            <View style={styles.settingRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Dark Mode
              </ThemedText>
              <Switch
                value={isEnabled}
                onValueChange={handleThemeChange}
                trackColor={{ false: '#E1E1E1', true: '#34C759' }}
                thumbColor="#FFFFFF"
              />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => handlePress('https://meetcal.app/privacy')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.link, { color: colors.link }]}>
                Privacy Policy & Terms of Use
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
            onPress={() => handlePress('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.link, { color: colors.link }]}>
                End User License Agreement
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>
        </View>

        <View style={styles.dangerZone}>
          <Pressable
            style={({ pressed }) => [
              styles.resetButton,
              pressed && { opacity: 0.8 }
            ]}
            onPress={handleResetSessions}
          >
            <ThemedText style={styles.resetButtonText}>
              Reset Saved Sessions
            </ThemedText>
          </Pressable>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border, marginTop: 32 }]} />
        <ThemedText style={[styles.copyright, { color: colors.secondaryText }]}>
          © 2025 CoachHub
        </ThemedText>
      </ScrollView>

      {/* Meet Selection Modal */}
      <Modal
        visible={showMeetModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMeetModal(false)}
      >
        <Pressable 
          style={[
            styles.modalOverlay,
            { backgroundColor: currentTheme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.4)' }
          ]}
          onPress={() => setShowMeetModal(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <ThemedText style={[styles.modalTitle, { color: colors.text }]}>
                Select Your Meet
              </ThemedText>
              <Pressable
                style={({ pressed }) => [
                  styles.closeButton,
                  pressed && { opacity: 0.8 }
                ]}
                onPress={() => setShowMeetModal(false)}
              >
                <IconSymbol 
                  name={Platform.OS === 'ios' ? 'xmark' : 'close'}
                  size={20} 
                  color={colors.secondaryText} 
                />
              </Pressable>
            </View>
            
            {['USAW Master\'s Nationals', 'USAMW Master\'s Nationals'].map((meet) => (
              <Pressable
                key={meet}
                style={({ pressed }) => [
                  styles.modalOption,
                  { borderBottomColor: colors.border },
                  selectedMeet === meet && { backgroundColor: colors.pressed },
                  pressed && { opacity: 0.8 }
                ]}
                onPress={() => handleMeetSelect(meet as MeetName)}
              >
                <ThemedText style={[
                  styles.modalOptionText,
                  { color: colors.text },
                  selectedMeet === meet && { color: '#007AFF' }
                ]}>
                  {meet}
                </ThemedText>
                {selectedMeet === meet && (
                  <IconSymbol name="checkmark" size={16} color="#007AFF" />
                )}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
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
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    padding: 16,
    paddingBottom: 8,
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
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingLabel: {
    fontSize: 16,
    marginBottom: 4,
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
    marginTop: 16,
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