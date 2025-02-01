import { View, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { getPlatformColors } from '@/data/schedule';
import { Platform } from '@/data/athletes';
import { Stack } from 'expo-router';

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
function SavedSessionItem({ 
  session, 
  platform, 
  weightClass 
}: { 
  session: string; 
  platform?: Platform; 
  weightClass: string;
}) {
  return (
    <View style={styles.sessionItem}>
      {platform && <PlatformBadge platform={platform} />}
      <ThemedText>{weightClass}</ThemedText>
    </View>
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