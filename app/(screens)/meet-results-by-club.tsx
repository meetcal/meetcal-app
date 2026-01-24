import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  ActivityIndicator,
  ScrollView,
  Pressable,
  Platform,
  Modal,
  Image,
} from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { useTheme } from '@/contexts/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { fetchClubMeetStats } from '@/lib/database/fetch-club-stats';
import type { ClubMeetStats } from '@/types/club';
import { posthog } from '@/lib/posthog';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';

export default function MeetResultsByClubScreen() {
  const { currentTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { club, meet } = useLocalSearchParams<{ club: string; meet: string }>();

  const [isLoading, setIsLoading] = useState(true);
  const [clubStats, setClubStats] = useState<ClubMeetStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [generatedImageUri, setGeneratedImageUri] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  const shareableViewRef = useRef<View>(null);

  // Track screen view on mount
  useEffect(() => {
    posthog.capture('screen_viewed', {
      screen_name: 'Meet Results By Club',
      club_name: club,
      meet_name: meet,
    });
  }, [club, meet]);

  // Define theme colors
  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
    link: '#007AFF',
  };

  // Load stats on mount
  useEffect(() => {
    if (club && meet) {
      loadStats();
    }
  }, [club, meet]);

  const loadStats = async () => {
    if (!club || !meet) return;

    setIsLoading(true);
    setError(null);

    try {
      const stats = await fetchClubMeetStats(club, meet);
      setClubStats(stats);
    } catch (err) {
      console.error('Error loading stats:', err);
      setError('Failed to load meet statistics');
    } finally {
      setIsLoading(false);
    }
  };

  const generateImage = async () => {
    if (!shareableViewRef.current || !clubStats || clubStats.totalAthletes === 0) {
      return;
    }

    setIsGeneratingImage(true);

    try {
      const uri = await captureRef(shareableViewRef.current, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });

      setGeneratedImageUri(uri);
      setShowPreview(true);

      posthog.capture('club_meet_recap_generated', {
        club_name: club,
        meet_name: meet,
      });
    } catch (err) {
      console.error('Error generating image:', err);
      alert('Failed to generate image');
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleShare = async () => {
    if (!generatedImageUri) return;

    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        alert('Sharing is not available on this device');
        return;
      }

      await Sharing.shareAsync(generatedImageUri, {
        mimeType: 'image/png',
        dialogTitle: 'Share Meet Recap',
      });

      posthog.capture('club_meet_recap_shared', {
        club_name: club,
        meet_name: meet,
      });
    } catch (error) {
      console.error('Error sharing image:', error);
      alert('Failed to share image');
    }
  };

  if (isLoading) {
    return (
      <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen
          options={{
            headerTitle: 'Meet Recap',
            headerTitleStyle: { color: colors.text },
            headerStyle: {
              backgroundColor: currentTheme === 'dark' ? '#000000' : '#FFFFFF',
            },
            headerShadowVisible: false,
          }}
        />
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.link} />
          <ThemedText style={[styles.emptyText, { color: colors.secondaryText, marginTop: 16 }]}>
            Loading statistics...
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (error || !clubStats) {
    return (
      <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen
          options={{
            headerTitle: 'Meet Recap',
            headerTitleStyle: { color: colors.text },
            headerStyle: {
              backgroundColor: currentTheme === 'dark' ? '#000000' : '#FFFFFF',
            },
            headerShadowVisible: false,
          }}
        />
        <View style={styles.centerContainer}>
          <ThemedText style={[styles.emptyTitle, { color: colors.text }]}>
            Error loading statistics
          </ThemedText>
          <ThemedText style={[styles.emptyText, { color: colors.secondaryText }]}>
            {error || 'Unknown error'}
          </ThemedText>
          <Pressable style={[styles.retryButton, { backgroundColor: colors.link }]} onPress={loadStats}>
            <ThemedText style={styles.retryButtonText}>Retry</ThemedText>
          </Pressable>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerTitle: 'Meet Recap',
          headerTitleStyle: { color: colors.text },
          headerStyle: {
            backgroundColor: currentTheme === 'dark' ? '#000000' : '#FFFFFF',
          },
          headerShadowVisible: false,
          headerBackVisible: true,
          headerTintColor: colors.link,
        }}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{
          paddingTop: insets.top + 40,
          paddingBottom: Math.max(80, insets.bottom + 60),
        }}
      >
        {/* Club and Meet Header */}
        <View style={styles.header}>
          <ThemedText style={[styles.clubName, { color: colors.text }]}>{club}</ThemedText>
          <ThemedText style={[styles.meetName, { color: colors.secondaryText }]}>{meet}</ThemedText>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <StatCard
            title="Athletes"
            value={clubStats.totalAthletes.toString()}
            icon={Platform.OS === 'ios' ? 'person.3.fill' : 'people'}
            color="#007AFF"
            currentTheme={currentTheme}
          />
          <StatCard
            title="Total Weight"
            value={`${Math.round(clubStats.totalWeightLifted)} kg`}
            icon={Platform.OS === 'ios' ? 'scalemass.fill' : 'barbell'}
            color="#AF52DE"
            currentTheme={currentTheme}
          />
          <StatCard
            title="Competition PRs"
            value={clubStats.totalPRs.toString()}
            icon={Platform.OS === 'ios' ? 'star.fill' : 'star'}
            color="#FF9500"
            currentTheme={currentTheme}
          />
          <StatCard
            title="Perfect 6/6"
            value={clubStats.perfect6for6.toString()}
            icon={Platform.OS === 'ios' ? 'checkmark.circle.fill' : 'checkmark-circle'}
            color="#34C759"
            currentTheme={currentTheme}
          />
        </View>

        {/* Medals Section */}
        <View style={[styles.medalsContainer, { backgroundColor: colors.card }]}>
          <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>Medals</ThemedText>
          <View style={styles.medalsRow}>
            <MedalView count={clubStats.goldMedals} type="Gold" color="#FFD700" />
            <MedalView count={clubStats.silverMedals} type="Silver" color="#C0C0C0" />
            <MedalView count={clubStats.bronzeMedals} type="Bronze" color="#CD7F32" />
          </View>
        </View>

        {/* Share Button */}
        <View style={styles.shareButtonContainer}>
          <Pressable
            onPress={generateImage}
            disabled={isGeneratingImage || clubStats.totalAthletes === 0}
            style={({ pressed }) => [
              styles.mainShareButton,
              { 
                backgroundColor: colors.link,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            {isGeneratingImage ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <IconSymbol
                  name={Platform.OS === 'ios' ? 'square.and.arrow.up' : 'share'}
                  size={20}
                  color="#FFFFFF"
                />
                <ThemedText style={styles.mainShareButtonText}>Share Meet Recap</ThemedText>
              </View>
            )}
          </Pressable>
        </View>
      </ScrollView>

      {/* Hidden shareable view - rendered off-screen for image generation */}
      <View style={styles.offScreen}>
        <View ref={shareableViewRef} collapsable={false}>
          <ShareableRecapView
            club={club || ''}
            meet={meet || ''}
            stats={clubStats}
          />
        </View>
      </View>

      {/* Image Preview Modal */}
      <ImagePreviewModal
        visible={showPreview}
        imageUri={generatedImageUri}
        onClose={() => setShowPreview(false)}
        onShare={handleShare}
        currentTheme={currentTheme}
      />
    </ThemedView>
  );
}

// Stat Card Component
function StatCard({
  title,
  value,
  icon,
  color,
  currentTheme,
}: {
  title: string;
  value: string;
  icon: string;
  color: string;
  currentTheme: string;
}) {
  const cardBg = currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF';

  return (
    <View style={[styles.statCard, { backgroundColor: cardBg }]}>
      <IconSymbol name={icon} size={30} color={color} />
      <ThemedText style={styles.statValue}>{value}</ThemedText>
      <ThemedText style={styles.statTitle}>{title}</ThemedText>
    </View>
  );
}

// Medal View Component
function MedalView({ count, type, color }: { count: number; type: string; color: string }) {
  return (
    <View style={styles.medalItem}>
      <View style={[styles.medalCircle, { backgroundColor: color }]}>
        <ThemedText style={styles.medalCount}>{count}</ThemedText>
      </View>
      <ThemedText style={styles.medalType}>{type}</ThemedText>
    </View>
  );
}

// Shareable Recap View (for image generation)
const ShareableRecapView = React.forwardRef<View, { club: string; meet: string; stats: ClubMeetStats }>(
  ({ club, meet, stats }, ref) => {
    return (
      <View ref={ref} style={shareableStyles.container}>
        <View style={shareableStyles.header}>
          <ThemedText style={shareableStyles.clubName}>{club}</ThemedText>
          <ThemedText style={shareableStyles.meetName}>{meet}</ThemedText>
        </View>

        <View style={shareableStyles.statsGrid}>
          <ShareableStatCard title="Athletes" value={stats.totalAthletes.toString()} emoji="👥" color="#007AFF" />
          <ShareableStatCard
            title="Total Weight"
            value={`${Math.round(stats.totalWeightLifted)} kg`}
            emoji="⚖️"
            color="#AF52DE"
          />
          <ShareableStatCard title="Competition PRs" value={stats.totalPRs.toString()} emoji="⭐" color="#FF9500" />
          <ShareableStatCard title="Perfect 6/6" value={stats.perfect6for6.toString()} emoji="✅" color="#34C759" />
        </View>

        <View style={shareableStyles.medalsContainer}>
          <ThemedText style={shareableStyles.medalsTitle}>Medals</ThemedText>
          <View style={shareableStyles.medalsRow}>
            <ShareableMedalView count={stats.goldMedals} type="Gold" color="#FFD700" />
            <ShareableMedalView count={stats.silverMedals} type="Silver" color="#C0C0C0" />
            <ShareableMedalView count={stats.bronzeMedals} type="Bronze" color="#CD7F32" />
          </View>
        </View>

        <View style={shareableStyles.footer}>
          <ThemedText style={shareableStyles.footerText}>Generated by MeetCal</ThemedText>
          <Image source={require('@/assets/images/MeetCal-no-bg.png')} style={shareableStyles.logo} resizeMode="contain" />
        </View>
      </View>
    );
  }
);

// Shareable Stat Card
function ShareableStatCard({ title, value, emoji, color }: { title: string; value: string; emoji: string; color: string }) {
  return (
    <View style={shareableStyles.statCard}>
      <ThemedText style={[shareableStyles.statEmoji, { color }]}>{emoji}</ThemedText>
      <ThemedText style={shareableStyles.statValue}>{value}</ThemedText>
      <ThemedText style={shareableStyles.statTitle}>{title}</ThemedText>
    </View>
  );
}

// Shareable Medal View
function ShareableMedalView({ count, type, color }: { count: number; type: string; color: string }) {
  return (
    <View style={shareableStyles.medalItem}>
      <View style={[shareableStyles.medalCircle, { backgroundColor: color }]}>
        <ThemedText style={shareableStyles.medalCount}>{count}</ThemedText>
      </View>
      <ThemedText style={shareableStyles.medalType}>{type}</ThemedText>
    </View>
  );
}

// Image Preview Modal Component
function ImagePreviewModal({
  visible,
  imageUri,
  onClose,
  onShare,
  currentTheme,
}: {
  visible: boolean;
  imageUri: string | null;
  onClose: () => void;
  onShare: () => void;
  currentTheme: string;
}) {
  const insets = useSafeAreaInsets();
  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ThemedView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.modalHeader,
            Platform.OS === 'android' && { paddingTop: Math.max(insets.top, 12) + 12 },
          ]}
        >
          <ThemedText style={[styles.modalTitle, { color: colors.text }]}>Recap Preview</ThemedText>
          <Pressable
            style={[
              styles.closeButton,
              Platform.OS === 'android' && { top: Math.max(insets.top, 12) + 6 },
            ]}
            onPress={onClose}
          >
            <ThemedText style={{ color: '#007AFF', fontSize: 17, fontWeight: '600' }}>Done</ThemedText>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.modalContent}>
          {imageUri && (
            <>
              <Image source={{ uri: imageUri }} style={styles.previewImage} resizeMode="contain" />
              <Pressable style={styles.shareButton} onPress={onShare}>
                <IconSymbol name={Platform.OS === 'ios' ? 'square.and.arrow.up' : 'share'} size={20} color="#FFFFFF" />
                <ThemedText style={styles.shareButtonText}>Share Recap</ThemedText>
              </Pressable>
            </>
          )}
        </ScrollView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 8,
  },
  clubName: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    paddingTop: 30,
  },
  meetName: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 16,
    gap: 16,
  },
  statCard: {
    width: '47%',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    gap: 8,
  },
  statValue: {
    fontSize: 28,
    lineHeight: 32,
    includeFontPadding: false,
    fontWeight: 'bold',
  },
  statTitle: {
    fontSize: 12,
    color: '#8E8E93',
  },
  medalsContainer: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 16,
  },
  medalsRow: {
    flexDirection: 'row',
    gap: 30,
  },
  medalItem: {
    alignItems: 'center',
    gap: 8,
  },
  medalCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  medalCount: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  medalType: {
    fontSize: 12,
    color: '#8E8E93',
  },
  shareButtonContainer: {
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  mainShareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  mainShareButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  offScreen: {
    position: 'absolute',
    left: -10000,
    top: 0,
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E1E1E1',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  closeButton: {
    position: 'absolute',
    right: 16,
  },
  modalContent: {
    padding: 20,
    alignItems: 'center',
    gap: 20,
  },
  previewImage: {
    width: '100%',
    aspectRatio: 0.8,
    borderRadius: 12,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    width: '100%',
  },
  shareButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
});

// Shareable view styles (for image generation)
const shareableStyles = StyleSheet.create({
  container: {
    width: 800,
    height: 1000,
    backgroundColor: '#FFFFFF',
    padding: 0,
  },
  header: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 12,
  },
  clubName: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#000000',
    textAlign: 'center',
    lineHeight: 42,
  },
  meetName: {
    fontSize: 24,
    fontWeight: '600',
    color: '#007AFF',
    textAlign: 'center',
    lineHeight: 30,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 30,
    gap: 20,
    justifyContent: 'space-between',
  },
  statCard: {
    width: '47%',
    paddingVertical: 30,
    backgroundColor: '#F2F2F7',
    borderRadius: 16,
    alignItems: 'center',
    gap: 12,
  },
  statEmoji: {
    fontSize: 48,
    lineHeight: 54,
  },
  statValue: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#000000',
    lineHeight: 42,
  },
  statTitle: {
    fontSize: 14,
    color: '#8E8E93',
    lineHeight: 18,
  },
  medalsContainer: {
    marginTop: 30,
    marginHorizontal: 30,
    padding: 20,
    backgroundColor: '#F2F2F7',
    borderRadius: 20,
    alignItems: 'center',
  },
  medalsTitle: {
    fontSize: 28,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 20,
    lineHeight: 34,
  },
  medalsRow: {
    flexDirection: 'row',
    gap: 50,
    paddingBottom: 20,
  },
  medalItem: {
    alignItems: 'center',
    gap: 12,
  },
  medalCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  medalCount: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#FFFFFF',
    lineHeight: 42,
  },
  medalType: {
    fontSize: 16,
    color: '#8E8E93',
    lineHeight: 20,
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  footerText: {
    fontSize: 14,
    color: '#8E8E93',
    lineHeight: 18,
  },
  logo: {
    width: 30,
    height: 30,
  },
});
