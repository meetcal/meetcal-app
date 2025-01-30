import { StyleSheet, View, FlatList, Pressable, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMemo, useState, useEffect, useRef } from 'react';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useSavedSessions } from '@/contexts/SavedSessionsContext';
import { useTheme } from '@/contexts/ThemeContext';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { schedule } from '@/data/schedule';

// Platform colors for visual reference
const platformColors = {
  Red: '#FF6B6B',
  White: '#4A4A4A',
  Blue: '#4DABF7',
};

// Set up notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export default function SavedScreen() {
  const { savedSessions } = useSavedSessions();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [letterFilter, setLetterFilter] = useState('');
  const [showFilterModal, setShowFilterModal] = useState(false);
  const { currentTheme } = useTheme();
  const [expoPushToken, setExpoPushToken] = useState('');
  const [notificationPermission, setNotificationPermission] = useState(false);
  const notificationListener = useRef();
  const responseListener = useRef();

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
  };

  // Extract unique letters from saved sessions
  const filterOptions = useMemo(() => {
    const letterSet = new Set<string>();
    savedSessions.forEach(session => {
      const letter = session.weightClass.split(' ')[1];
      if (letter) letterSet.add(letter);
    });
    return Array.from(letterSet).sort();
  }, [savedSessions]);

  // Filter saved sessions
  const filteredSessions = useMemo(() => {
    if (!letterFilter) return savedSessions;
    return savedSessions.filter(session => 
      session.weightClass.endsWith(letterFilter)
    );
  }, [savedSessions, letterFilter]);

  const handleFilterSelect = (letter: string) => {
    setLetterFilter(letter);
    setShowFilterModal(false);
  };

  // Set up notifications when component mounts
  useEffect(() => {
    registerForPushNotifications();

    // Listen for incoming notifications
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received:', notification);
    });

    // Listen for user interaction with notifications
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      const sessionId = response.notification.request.content.data.sessionId;
      if (sessionId) {
        router.push({
          pathname: '/(screens)/schedule-details',
          params: { id: sessionId }
        });
      }
    });

    // Cleanup
    return () => {
      Notifications.removeNotificationSubscription(notificationListener.current);
      Notifications.removeNotificationSubscription(responseListener.current);
    };
  }, []);

  // Register for push notifications
  async function registerForPushNotifications() {
    if (!Device.isDevice) {
      alert('Push notifications are not available in the simulator');
      return;
    }

    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      
      if (finalStatus !== 'granted') {
        alert('Failed to get push notification permissions');
        return;
      }

      setNotificationPermission(true);
    } catch (error) {
      console.error('Error getting push token:', error);
    }
  }

  // Schedule notification for a session
  const scheduleWeighInNotification = async (session) => {
    if (!notificationPermission) return;

    try {
      // Find the session day from schedule data
      const sessionDay = schedule.find(day => 
        day.sessions.some(s => 
          s.platforms.some(p => 
            `${s.id}-${p.platform}` === session.id
          )
        )
      );

      if (!sessionDay) {
        console.error('Could not find session day');
        return;
      }

      // Parse the start time
      const [time, period] = session.startTime.split(' ');
      const [hours, minutes] = time.split(':').map(Number);
      
      let startHour = hours;
      if (period === 'PM' && hours !== 12) {
        startHour += 12;
      } else if (period === 'AM' && hours === 12) {
        startHour = 0;
      }

      // Create date object for the session day
      const [year, month, day] = sessionDay.fullDate.split('-').map(Number);
      const startDate = new Date(year, month - 1, day, startHour, minutes);
      
      // Set weigh-in time (2 hours before)
      const weighInDate = new Date(startDate.getTime());
      weighInDate.setHours(weighInDate.getHours() - 2);

      // Only schedule if weigh-in time is in the future
      if (weighInDate > new Date()) {
        const notificationId = await Notifications.scheduleNotificationAsync({
          content: {
            title: `Weigh-in Time - Session ${session.sessionNumber}`,
            body: `Weigh-in for ${session.weightClass} on Platform ${session.platform} begins now`,
            data: { sessionId: session.id },
          },
          trigger: {
            date: weighInDate,
          },
        });

        await saveNotificationId(session.id, notificationId);
      }
    } catch (error) {
      console.error('Error scheduling notification:', error);
    }
  };

  // Cancel notification when session is unsaved
  const cancelWeighInNotification = async (sessionId) => {
    try {
      const notificationId = await getNotificationId(sessionId); // Implement this
      if (notificationId) {
        await Notifications.cancelScheduledNotificationAsync(notificationId);
        await removeNotificationId(sessionId); // Implement this
      }
    } catch (error) {
      console.error('Error canceling notification:', error);
    }
  };

  const renderSession = ({ item }) => (
    <Pressable
      style={({ pressed }) => [
        styles.sessionContainer,
        { backgroundColor: colors.card },
        pressed && { backgroundColor: colors.pressed }
      ]}
      onPress={() => router.push({
        pathname: '/(screens)/schedule-details',
        params: item
      })}
    >
      <ThemedText style={[styles.sessionTitle, { color: colors.text }]}>
        Session {item.sessionNumber}
      </ThemedText>
      <View style={styles.timeContainer}>
        <View style={styles.timeRow}>
          <View style={styles.timeBlock}>
            <ThemedText style={[styles.timeLabel, { color: colors.secondaryText }]}>
              Weigh-in:
            </ThemedText>
            <ThemedText style={[styles.timeText, { color: colors.secondaryText }]}>
              {item.weighInTime}
            </ThemedText>
          </View>
          <View style={styles.timeSeparator} />
          <View style={styles.timeBlock}>
            <ThemedText style={[styles.timeLabel, { color: colors.secondaryText }]}>
              Start:
            </ThemedText>
            <ThemedText style={[styles.timeText, { color: colors.secondaryText }]}>
              {item.startTime}
            </ThemedText>
          </View>
        </View>
      </View>
      
      <View style={[styles.platformContainer, { backgroundColor: colors.card }]}>
        <View style={[
          styles.platformIndicator,
          { backgroundColor: platformColors[item.platform as keyof typeof platformColors] }
        ]}>
          <ThemedText style={styles.platformText}>
            {item.platform}
          </ThemedText>
        </View>
        <ThemedText style={[styles.weightClassText, { color: colors.secondaryText }]}>
          {item.weightClass}
        </ThemedText>
      </View>
    </Pressable>
  );

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.filterContainer, { 
        backgroundColor: colors.background,
        borderBottomColor: currentTheme === 'dark' ? '#2C2C2E' : '#C6C6C8',
        borderBottomWidth: 1,
      }]}>
        <Pressable
          style={({ pressed }) => [
            styles.filterButton,
            { 
              backgroundColor: colors.card,
              borderColor: colors.border 
            },
            pressed && { backgroundColor: colors.pressed }
          ]}
          onPress={() => setShowFilterModal(true)}
        >
          <ThemedText style={[styles.filterButtonText, { color: colors.secondaryText }]}>
            {letterFilter ? `${letterFilter} Sessions` : 'Filter By Session'}
          </ThemedText>
          <IconSymbol name="chevron.down" size={12} color={colors.secondaryText} />
        </Pressable>
      </View>

      <FlatList
        data={filteredSessions}
        keyExtractor={item => item.id}
        renderItem={renderSession}
        contentContainerStyle={styles.list}
        ListEmptyComponent={() => (
          <View style={styles.emptyContainer}>
            <ThemedText style={styles.emptyText}>
              {letterFilter 
                ? `No ${letterFilter} sessions found`
                : 'No saved sessions'}
            </ThemedText>
          </View>
        )}
      />

      <Modal
        visible={showFilterModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFilterModal(false)}
      >
        <Pressable 
          style={[styles.modalOverlay, { 
            backgroundColor: currentTheme === 'dark' 
              ? 'rgba(0,0,0,0.6)' 
              : 'rgba(0,0,0,0.4)' 
          }]}
          onPress={() => setShowFilterModal(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Pressable
              style={({ pressed }) => [
                styles.modalOption,
                { borderBottomColor: colors.border },
                letterFilter === '' && { backgroundColor: colors.pressed },
                pressed && { opacity: 0.8 }
              ]}
              onPress={() => handleFilterSelect('')}
            >
              <ThemedText style={[
                styles.modalOptionText,
                { color: colors.text },
                letterFilter === '' && { color: '#007AFF' }
              ]}>
                All Sessions
              </ThemedText>
              {letterFilter === '' && (
                <IconSymbol name="checkmark" size={16} color="#007AFF" />
              )}
            </Pressable>
            {filterOptions.map(letter => (
              <Pressable
                key={letter}
                style={({ pressed }) => [
                  styles.modalOption,
                  { borderBottomColor: colors.border },
                  letterFilter === letter && { backgroundColor: colors.pressed },
                  pressed && { opacity: 0.8 }
                ]}
                onPress={() => handleFilterSelect(letter)}
              >
                <ThemedText style={[
                  styles.modalOptionText,
                  { color: colors.text },
                  letterFilter === letter && { color: '#007AFF' }
                ]}>
                  {letter} Session
                </ThemedText>
                {letterFilter === letter && (
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
  filterContainer: {
    padding: 16,
    backgroundColor: '#F5F5F5',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C6C6C8',
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#C6C6C8',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    elevation: 1,
  },
  filterButtonPressed: {
    opacity: 0.8,
  },
  filterButtonText: {
    fontSize: 15,
    color: '#666666',
    fontWeight: '600',
  },
  list: {
    padding: 16,
  },
  sessionContainer: {
    backgroundColor: '#FFFFFF',
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
  sessionContainerPressed: {
    opacity: 0.9,
  },
  sessionTitle: {
    fontSize: 17,
    fontWeight: '600',
    padding: 16,
    paddingBottom: 0,
  },
  timeContainer: {
    padding: 16,
    paddingTop: 8,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  timeBlock: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeSeparator: {
    width: 24,
  },
  timeLabel: {
    fontSize: 14,
    color: '#666',
    marginRight: 4,
  },
  timeText: {
    fontSize: 15,
    color: '#666',
  },
  platformContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    overflow: 'hidden',
    margin: 16,
    marginTop: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  platformIndicator: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  platformText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  weightClassText: {
    fontSize: 15,
    color: '#666',
  },
  emptyContainer: {
    padding: 16,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
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