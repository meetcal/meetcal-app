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
import { fetchNationalRankings } from '@/lib/database/fetch-national-rankings';
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

const NATIONAL_RANKINGS_AGE_GROUPS = [
  'U11', 'U13', 'U15', 'U17', 'Junior', 'Senior',
  'Masters 35', 'Masters 40', 'Masters 45', 'Masters 50', 'Masters 55',
  'Masters 60', 'Masters 65', 'Masters 70', 'Masters 75', 'Masters 80',
  'Masters 85', 'Masters 90+'
] as const;

function getNationalRankingsWeightClasses(gender: 'Men' | 'Women', ageGroup: string): string[] {
  let prefix = `Open ${gender}`;

  switch (ageGroup) {
    case 'U11':
      prefix = `${gender}'s 11 Under Age Group`;
      break;
    case 'U13':
      prefix = `${gender}'s 13 Under Age Group`;
      break;
    case 'U15':
      prefix = `${gender}'s 14-15 Age Group`;
      break;
    case 'U17':
      prefix = `${gender}'s 16-17 Age Group`;
      break;
    case 'Junior':
      prefix = `Junior ${gender}`;
      break;
    case 'Senior':
      prefix = `Open ${gender}`;
      break;
    case 'Masters 35':
      prefix = `${gender}'s Masters (35-39)`;
      break;
    case 'Masters 40':
      prefix = `${gender}'s Masters (40-44)`;
      break;
    case 'Masters 45':
      prefix = `${gender}'s Masters (45-49)`;
      break;
    case 'Masters 50':
      prefix = `${gender}'s Masters (50-54)`;
      break;
    case 'Masters 55':
      prefix = `${gender}'s Masters (55-59)`;
      break;
    case 'Masters 60':
      prefix = `${gender}'s Masters (60-64)`;
      break;
    case 'Masters 65':
      prefix = `${gender}'s Masters (65-69)`;
      break;
    case 'Masters 70':
      prefix = `${gender}'s Masters (70-74)`;
      break;
    case 'Masters 75':
      prefix = `${gender}'s Masters (75-79)`;
      break;
    case 'Masters 80':
      prefix = `${gender}'s Masters (80-84)`;
      break;
    case 'Masters 85':
      prefix = `${gender}'s Masters (85-89)`;
      break;
    case 'Masters 90+':
      prefix = `${gender}'s Masters (90+)`;
      break;
    default:
      prefix = `Open ${gender}`;
  }

  switch (`${gender}-${ageGroup}`) {
    case 'Men-Masters 35':
    case 'Men-Masters 40':
    case 'Men-Masters 45':
    case 'Men-Masters 50':
    case 'Men-Masters 55':
    case 'Men-Masters 60':
    case 'Men-Masters 65':
    case 'Men-Masters 70':
    case 'Men-Masters 75':
    case 'Men-Masters 80':
    case 'Men-Masters 85':
    case 'Men-Masters 90+':
      return ['60kg', '65kg', '71kg', '79kg', '88kg', '94kg', '110kg', '110+kg'].map(w => `${prefix} ${w}`);
    case 'Women-Masters 35':
    case 'Women-Masters 40':
    case 'Women-Masters 45':
    case 'Women-Masters 50':
    case 'Women-Masters 55':
    case 'Women-Masters 60':
    case 'Women-Masters 65':
    case 'Women-Masters 70':
    case 'Women-Masters 75':
    case 'Women-Masters 80':
    case 'Women-Masters 85':
    case 'Women-Masters 90+':
      return ['48kg', '53kg', '58kg', '63kg', '69kg', '77kg', '86kg', '86+kg'].map(w => `${prefix} ${w}`);
    case 'Men-Junior':
    case 'Men-Senior':
      return ['60kg', '65kg', '71kg', '79kg', '88kg', '94kg', '110kg', '110+kg'].map(w => `${prefix}'s ${w}`);
    case 'Women-Junior':
    case 'Women-Senior':
      return ['48kg', '53kg', '58kg', '63kg', '69kg', '77kg', '86kg', '86+kg'].map(w => `${prefix}'s ${w}`);
    case 'Men-U17':
      return ['56kg', '60kg', '65kg', '71kg', '79kg', '88kg', '94kg', '94+kg'].map(w => `${prefix} ${w}`);
    case 'Women-U17':
      return ['44kg', '48kg', '53kg', '58kg', '63kg', '69kg', '77kg', '77+kg'].map(w => `${prefix} ${w}`);
    case 'Men-U15':
      return ['48kg', '52kg', '56kg', '60kg', '65kg', '71kg', '79kg', '79+kg'].map(w => `${prefix} ${w}`);
    case 'Women-U15':
      return ['40kg', '44kg', '48kg', '53kg', '58kg', '63kg', '69kg', '69+kg'].map(w => `${prefix} ${w}`);
    case 'Men-U13':
    case 'Men-U11':
      return ['40kg', '44kg', '48kg', '52kg', '56kg', '60kg', '65kg', '65+kg'].map(w => `${prefix} ${w}`);
    case 'Women-U13':
    case 'Women-U11':
      return ['36kg', '40kg', '44kg', '48kg', '53kg', '58kg', '63kg', '63+kg'].map(w => `${prefix} ${w}`);
    default:
      return [];
  }
}

async function downloadAllNationalRankings(): Promise<void> {
  const genders: Array<'Men' | 'Women'> = ['Men', 'Women'];

  for (const gender of genders) {
    for (const ageGroup of NATIONAL_RANKINGS_AGE_GROUPS) {
      const classes = getNationalRankingsWeightClasses(gender, ageGroup);
      for (const weightClass of classes) {
        await fetchNationalRankings(weightClass);
      }
    }
  }
}

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
      nationalRankingsCache,
    ] = await Promise.all([
      getOfflineCache(OFFLINE_CACHE_KEYS.standards),
      getOfflineCache(OFFLINE_CACHE_KEYS.qualifyingTotals),
      getOfflineCache(OFFLINE_CACHE_KEYS.intlRankings),
      getOfflineCache(OFFLINE_CACHE_KEYS.records),
      getOfflineCache(OFFLINE_CACHE_KEYS.wsoRecords),
      getOfflineCache(OFFLINE_CACHE_KEYS.adaptiveRecords),
      getOfflineCache(OFFLINE_CACHE_KEYS.nationalRankings),
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
    nextStatuses.nationalRankings = {
      isDownloaded: Boolean(nationalRankingsCache?.data),
      lastSynced: nationalRankingsCache?.lastSynced ?? null
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
        clearOfflineCache(OFFLINE_CACHE_KEYS.nationalRankings),
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
      id: 'nationalRankings',
      title: 'National Rankings',
      onDownload: async () => {
        await downloadAllNationalRankings();
      },
      onDelete: async () => {
        await clearOfflineCache(OFFLINE_CACHE_KEYS.nationalRankings);
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
