import { View, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { getPlatformColors } from '@/data/schedule';
import { Platform } from '@/data/athletes';

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

// Add to your existing styles
const styles = StyleSheet.create({
  platformBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  platformText: {
    color: '#FFFFFF',  // White text for contrast
    fontSize: 15,
    fontWeight: '600',
  },
});

// Usage in your saved sessions list
function SavedSessionItem({ session, platform, weightClass }) {
  return (
    <View style={styles.sessionItem}>
      {platform && <PlatformBadge platform={platform} />}
      <ThemedText>{weightClass}</ThemedText>
    </View>
  );
} 