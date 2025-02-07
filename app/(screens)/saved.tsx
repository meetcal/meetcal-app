import { View, StyleSheet, Pressable } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { getPlatformColors, schedule } from '@/data/schedule';
import { Platform } from '@/data/athletes';
import { Stack, useRouter } from 'expo-router';

// Inside your component where you render platform badges/colors
function PlatformBadge({ platform }: { platform: Platform }) {
  const platformColors = getPlatformColors();
  const backgroundColor = platformColors[platform];
  
  return (
    <View style={[styles.platformBadge, { backgroundColor }]}>
      <ThemedText style={styles.platformText}>
        {platform}
      </ThemedText>
    </View>
  );
}

// Usage in your saved sessions list
function SavedSessionItem({ session, platform }: { 
  session: string; 
  platform?: Platform;
}) {
  const router = useRouter();

  // Get the correct weight class from schedule.ts
  const sessionNumber = parseInt(session);
  const sessionDay = schedule.find(day => 
    day.sessions.some(s => s.number === sessionNumber)
  );
  
  const scheduleSession = sessionDay?.sessions.find(s => 
    s.number === sessionNumber
  );

  const platformData = scheduleSession?.platforms.find(p => 
    p.platform === platform
  );

  if (!platformData) {
    console.error('Platform data not found:', {
      session: sessionNumber,
      platform: platform
    });
    return null;
  }

  const handleSessionPress = () => {
    router.push({
      pathname: '/(screens)/schedule-details',
      params: {
        id: `session-${session}-${platform}`,
        sessionNumber: session,
        platform: platform,
        weightClass: platformData.weightClass, // Use schedule.ts weight class
        startTime: scheduleSession?.startTime || '',
        weighInTime: scheduleSession?.weighInTime || '',
        date: sessionDay?.fullDate || '',
      }
    });
  };

  return (
    <Pressable 
      style={styles.sessionItem}
      onPress={handleSessionPress}
    >
      {platform && <PlatformBadge platform={platform} />}
      <ThemedText>{platformData.weightClass}</ThemedText> {/* Show schedule.ts weight class */}
    </Pressable>
  );
}

export default function SavedScreen() {
  return (
    <ThemedView style={styles.container}>
      <Stack.Screen 
        options={{ 
          title: 'Saved Sessions',
          headerLargeTitle: true
        }} 
      />
      <View style={styles.content}>
        <View style={styles.emptyState}>
          <ThemedText style={styles.emptyTitle}>No Saved Sessions</ThemedText>
          <ThemedText style={styles.emptyDescription}>
            Save sessions to keep track of your competitions
          </ThemedText>
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 100,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptyDescription: {
    fontSize: 16,
    textAlign: 'center',
    opacity: 0.7,
  },
  sessionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  platformBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  platformText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
}); 