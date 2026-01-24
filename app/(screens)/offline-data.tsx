import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { Stack } from 'expo-router';
import { formatDistanceToNow } from 'date-fns';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { useTheme } from '@/contexts/ThemeContext';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { useSubscription } from '@/contexts/SubscriptionContext';
import PaywallScreen from './paywall';
import { useSelectedMeet } from '@/contexts/SelectedMeetContext';
import { getLastSyncTime, clearMeetData } from '@/lib/database/offline-store';
import { prefetchMeetData } from '@/lib/database/meet-manager';
import { fetchStandards } from '@/lib/database/fetch-standards';
import { fetchQualifyingTotals } from '@/lib/database/fetch-qualifying-totals';
import { fetchIntlRankings } from '@/lib/database/fetchIntlRankings';
import { fetchRecords, fetchFederations } from '@/lib/database/fetch-records';
import { fetchWSOList, fetchWSORecords } from '@/lib/database/fetch-wso-records';
import { fetchAdaptiveRecords } from '@/lib/database/fetch-adaptive-records';
import { clearOfflineCache, getOfflineCache, OFFLINE_CACHE_KEYS } from '@/lib/database/offline-cache';

type DownloadStatus = {
  isDownloaded: boolean;
  lastSynced: number | null;
};

type DownloadItem = {
  id: string;
  title: string;
  onDownload: () => Promise<void>;
  onDelete: () => Promise<void>;
  status: DownloadStatus | undefined;
  isDownloading: boolean;
};

export default function OfflineDataScreen() {
  const { currentTheme } = useTheme();
  const { isSubscribed, isLoading: isSubscriptionLoading } = useSubscription();
  const { availableMeets, isLoading: isMeetLoading } = useSelectedMeet();
  const [downloadingItems, setDownloadingItems] = useState<Set<string>>(new Set());
  const [downloadStatuses, setDownloadStatuses] = useState<Record<string, DownloadStatus>>({});
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  const filteredMeets = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endDate = new Date(startOfToday);
    endDate.setDate(endDate.getDate() + 21);

    return availableMeets.filter((meet) => {
      const startDateValue = meet?.dates?.start;
      if (!startDateValue) return false;
      const parsed = new Date(`${startDateValue}T00:00:00`);
      if (Number.isNaN(parsed.getTime())) return false;
      return parsed >= startOfToday && parsed <= endDate;
    });
  }, [availableMeets]);

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
    link: '#007AFF',
    danger: '#FF3B30',
  };

  const formatLastSynced = (lastSynced: number | null | undefined) => {
    if (!lastSynced) return 'Not downloaded yet';
    return `Last synced ${formatDistanceToNow(new Date(lastSynced), { addSuffix: true })}`;
  };

  const updateDownloading = useCallback((id: string, downloading: boolean) => {
    setDownloadingItems((prev) => {
      const next = new Set(prev);
      if (downloading) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const loadStatuses = useCallback(async () => {
    const nextStatuses: Record<string, DownloadStatus> = {};

    const [
      standardsCache,
      totalsCache,
      rankingsCache,
      recordsCache,
      wsoCache,
      adaptiveCache,
    ] = await Promise.all([
      getOfflineCache(OFFLINE_CACHE_KEYS.standards),
      getOfflineCache(OFFLINE_CACHE_KEYS.qualifyingTotals),
      getOfflineCache(OFFLINE_CACHE_KEYS.intlRankings),
      getOfflineCache(OFFLINE_CACHE_KEYS.records),
      getOfflineCache(OFFLINE_CACHE_KEYS.wsoRecords),
      getOfflineCache(OFFLINE_CACHE_KEYS.adaptiveRecords),
    ]);

    nextStatuses.standards = {
      isDownloaded: Boolean(standardsCache?.data),
      lastSynced: standardsCache?.lastSynced ?? null
    };
    nextStatuses.qualifyingTotals = {
      isDownloaded: Boolean(totalsCache?.data),
      lastSynced: totalsCache?.lastSynced ?? null
    };
    nextStatuses.intlRankings = {
      isDownloaded: Boolean(rankingsCache?.data),
      lastSynced: rankingsCache?.lastSynced ?? null
    };
    nextStatuses.records = {
      isDownloaded: Boolean(recordsCache?.data),
      lastSynced: recordsCache?.lastSynced ?? null
    };
    nextStatuses.wsoRecords = {
      isDownloaded: Boolean(wsoCache?.data),
      lastSynced: wsoCache?.lastSynced ?? null
    };
    nextStatuses.adaptiveRecords = {
      isDownloaded: Boolean(adaptiveCache?.data),
      lastSynced: adaptiveCache?.lastSynced ?? null
    };

    await Promise.all(
      availableMeets.map(async (meet) => {
        const lastSynced = await getLastSyncTime(meet.name);
        nextStatuses[`meet:${meet.name}`] = {
          isDownloaded: Boolean(lastSynced && lastSynced > 0),
          lastSynced: lastSynced ?? null
        };
      })
    );

    setDownloadStatuses(nextStatuses);
  }, [availableMeets]);

  useEffect(() => {
    loadStatuses();
  }, [loadStatuses, refreshCounter]);

  const handleDownload = async (id: string, action: () => Promise<void>) => {
    updateDownloading(id, true);
    try {
      await action();
      setRefreshCounter((count) => count + 1);
    } catch (error) {
      console.error('Download failed:', error);
      Alert.alert('Download Failed', 'Please check your connection and try again.');
    } finally {
      updateDownloading(id, false);
    }
  };

  const handleDelete = async (title: string, id: string, action: () => Promise<void>) => {
    Alert.alert(
      'Remove Download',
      `Remove ${title} from this device?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            updateDownloading(id, true);
            try {
              await action();
              setRefreshCounter((count) => count + 1);
            } catch (error) {
              console.error('Delete failed:', error);
              Alert.alert('Remove Failed', 'Please try again.');
            } finally {
              updateDownloading(id, false);
            }
          }
        }
      ]
    );
  };

  const refreshAllDownloadedData = async () => {
    if (isRefreshingAll || isDeletingAll) return;
    setIsRefreshingAll(true);

    try {
      const downloadedMeetNames = availableMeets
        .filter((meet) => downloadStatuses[`meet:${meet.name}`]?.isDownloaded)
        .map((meet) => meet.name);

      const downloadedCompetitionItems = competitionItems.filter(
        (item) => downloadStatuses[item.id]?.isDownloaded
      );

      await deleteAllOfflineData(false);

      for (const item of downloadedCompetitionItems) {
        await item.onDownload();
      }

      for (const meetName of downloadedMeetNames) {
        await prefetchMeetData(meetName);
      }

      setRefreshCounter((count) => count + 1);
      Alert.alert('Refresh Complete', 'All downloaded data has been refreshed.');
    } catch (error) {
      console.error('Refresh all failed:', error);
      Alert.alert('Refresh Failed', 'Please check your connection and try again.');
    } finally {
      setIsRefreshingAll(false);
    }
  };

  const deleteAllOfflineData = async (showSuccessAlert: boolean) => {
    if (isDeletingAll) return;
    setIsDeletingAll(true);
    try {
      await Promise.all([
        clearOfflineCache(OFFLINE_CACHE_KEYS.standards),
        clearOfflineCache(OFFLINE_CACHE_KEYS.qualifyingTotals),
        clearOfflineCache(OFFLINE_CACHE_KEYS.intlRankings),
        clearOfflineCache(OFFLINE_CACHE_KEYS.records),
        clearOfflineCache(OFFLINE_CACHE_KEYS.wsoRecords),
        clearOfflineCache(OFFLINE_CACHE_KEYS.adaptiveRecords),
      ]);

      for (const meet of availableMeets) {
        await clearMeetData(meet.name);
      }

      setRefreshCounter((count) => count + 1);
      if (showSuccessAlert) {
        Alert.alert('Deleted', 'All offline data has been removed from your device.');
      }
    } catch (error) {
      console.error('Delete all failed:', error);
      Alert.alert('Delete Failed', 'Please try again.');
    } finally {
      setIsDeletingAll(false);
    }
  };

  const confirmRefreshAll = () => {
    if (isRefreshingAll || isDeletingAll) return;
    Alert.alert(
      'Refresh All Downloads',
      'This will re-download everything you already saved for offline use.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Refresh All', onPress: refreshAllDownloadedData }
      ]
    );
  };

  const confirmDeleteAll = () => {
    if (isRefreshingAll || isDeletingAll) return;
    Alert.alert(
      'Delete All Offline Data',
      'This will remove all offline data from your device.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete All', style: 'destructive', onPress: () => deleteAllOfflineData(true) }
      ]
    );
  };

  const competitionItems: Omit<DownloadItem, 'status' | 'isDownloading'>[] = useMemo(() => ([
    {
      id: 'standards',
      title: 'A/B Standards',
      onDownload: async () => {
        await fetchStandards();
      },
      onDelete: async () => {
        await clearOfflineCache(OFFLINE_CACHE_KEYS.standards);
      },
    },
    {
      id: 'adaptiveRecords',
      title: 'Adaptive Records',
      onDownload: async () => {
        await fetchAdaptiveRecords();
      },
      onDelete: async () => {
        await clearOfflineCache(OFFLINE_CACHE_KEYS.adaptiveRecords);
      },
    },
    {
      id: 'records',
      title: 'National & World Records',
      onDownload: async () => {
        const federations = await fetchFederations();
        for (const federation of federations) {
          await fetchRecords(federation);
        }
      },
      onDelete: async () => {
        await clearOfflineCache(OFFLINE_CACHE_KEYS.records);
      },
    },
    {
      id: 'intlRankings',
      title: 'International Rankings',
      onDownload: async () => {
        await fetchIntlRankings();
      },
      onDelete: async () => {
        await clearOfflineCache(OFFLINE_CACHE_KEYS.intlRankings);
      },
    },
    {
      id: 'qualifyingTotals',
      title: 'Qualifying Totals',
      onDownload: async () => {
        await fetchQualifyingTotals();
      },
      onDelete: async () => {
        await clearOfflineCache(OFFLINE_CACHE_KEYS.qualifyingTotals);
      },
    },
    {
      id: 'wsoRecords',
      title: 'WSO Records',
      onDownload: async () => {
        const wsos = await fetchWSOList();
        for (const wso of wsos) {
          await fetchWSORecords(wso);
        }
      },
      onDelete: async () => {
        await clearOfflineCache(OFFLINE_CACHE_KEYS.wsoRecords);
      },
    },
  ]), []);

  if (isSubscriptionLoading || isMeetLoading) {
    return (
      <ThemedView style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.link} />
      </ThemedView>
    );
  }

  if (!isSubscribed) {
    return <PaywallScreen />;
  }

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ 
        title: 'Offline Data',
        headerBackTitle: 'Back',
        headerShown: true,
        gestureEnabled: true,
        gestureDirection: 'horizontal',
        animation: 'slide_from_right',
        headerStyle: {
          backgroundColor: colors.background,
        },
        headerShadowVisible: false,
        headerRight: () => (
          <View style={styles.headerActions}>
            <Pressable
              onPress={confirmRefreshAll}
              disabled={isRefreshingAll || isDeletingAll}
              style={({ pressed }) => [
                styles.headerButton,
                pressed && { opacity: 0.7 }
              ]}
            >
              {isRefreshingAll ? (
                <ActivityIndicator size="small" color={colors.link} />
              ) : (
                <IconSymbol name="arrow.clockwise" size={18} color={colors.link} />
              )}
            </Pressable>
            <Pressable
              onPress={confirmDeleteAll}
              disabled={isRefreshingAll || isDeletingAll}
              style={({ pressed }) => [
                styles.headerButton,
                pressed && { opacity: 0.7 }
              ]}
            >
              {isDeletingAll ? (
                <ActivityIndicator size="small" color={colors.danger} />
              ) : (
                <IconSymbol name="trash" size={18} color={colors.danger} />
              )}
            </Pressable>
          </View>
        ),
      }} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>
            Schedule & Start List
          </ThemedText>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {filteredMeets.length === 0 && (
              <View style={styles.emptyRow}>
                <ThemedText style={[styles.emptyText, { color: colors.secondaryText }]}>
                  No meets available right now.
                </ThemedText>
              </View>
            )}
            {filteredMeets.map((meet) => {
              const id = `meet:${meet.name}`;
              const status = downloadStatuses[id];
              const isDownloading = downloadingItems.has(id);
              return (
                <DownloadRow
                  key={id}
                  title={meet.name}
                  subtitle={formatLastSynced(status?.lastSynced)}
                  isDownloaded={status?.isDownloaded ?? false}
                  isDownloading={isDownloading}
                  colors={colors}
                  onDownload={() => handleDownload(id, () => prefetchMeetData(meet.name))}
                  onDelete={() => handleDelete(meet.name, id, () => clearMeetData(meet.name))}
                />
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>
            Competition Data
          </ThemedText>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {competitionItems.map((item) => {
              const status = downloadStatuses[item.id];
              const isDownloading = downloadingItems.has(item.id);
              return (
                <DownloadRow
                  key={item.id}
                  title={item.title}
                  subtitle={formatLastSynced(status?.lastSynced)}
                  isDownloaded={status?.isDownloaded ?? false}
                  isDownloading={isDownloading}
                  colors={colors}
                  onDownload={() => handleDownload(item.id, item.onDownload)}
                  onDelete={() => handleDelete(item.title, item.id, item.onDelete)}
                />
              );
            })}
          </View>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

function DownloadRow({
  title,
  subtitle,
  isDownloaded,
  isDownloading,
  onDownload,
  onDelete,
  colors,
}: {
  title: string;
  subtitle: string;
  isDownloaded: boolean;
  isDownloading: boolean;
  onDownload: () => void;
  onDelete: () => void;
  colors: {
    card: string;
    border: string;
    text: string;
    secondaryText: string;
    pressed: string;
    link: string;
    danger: string;
  };
}) {
  const iconName = isDownloaded ? 'trash' : 'arrow.down.circle';
  const iconColor = isDownloaded ? colors.danger : colors.link;

  return (
    <Pressable
      onPress={isDownloaded ? onDelete : onDownload}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: colors.border },
        pressed && { backgroundColor: colors.pressed }
      ]}
    >
      <View style={styles.rowText}>
        <ThemedText style={[styles.rowTitle, { color: colors.text }]}>
          {title}
        </ThemedText>
        <ThemedText style={[styles.rowSubtitle, { color: colors.secondaryText }]}>
          {subtitle}
        </ThemedText>
      </View>
      <View style={styles.rowAction}>
        {isDownloading ? (
          <ActivityIndicator size="small" color={colors.link} />
        ) : (
          <IconSymbol name={iconName} size={18} color={iconColor} />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 20,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  card: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: {
    flex: 1,
    paddingRight: 12,
    gap: 4,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  rowSubtitle: {
    fontSize: 13,
  },
  rowAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  emptyRow: {
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  emptyText: {
    fontSize: 14,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerButton: {
    padding: 4,
  },
});
