import { StyleSheet, View, FlatList, Dimensions, useWindowDimensions, ViewToken, ScrollView, Pressable, Modal, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useRef, useState, useMemo, useEffect } from 'react';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { SyncStatusBadge, LastSyncedIndicator } from '@/app/components/offline';
import { SyncManager } from '@/lib/database/sync-manager';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { getPlatformColors } from '@/data/schedule';
import { Session, Platform, DaySchedule, Schedule } from '@/types/schedule';
import { useTheme } from '@/contexts/ThemeContext';
import { PageIndicator } from '../../components/PageIndicator';
import { useSelectedMeet } from '@/contexts/SelectedMeetContext';
import { getSchedule } from '@/data/meets/scheduleManager';
import { getMeetConfig } from '@/data/meets/config';
import { initStore } from '@/lib/database/offline-store';

// Helper function to calculate weigh-in time
function calculateWeighInTime(startTime: string): string {
  const [time, period] = startTime.split(' ');
  const [hours, minutes] = time.split(':').map(Number);
  
  // Convert to 24 hour format
  let hour24 = hours;
  if (period === 'PM' && hours !== 12) hour24 += 12;
  if (period === 'AM' && hours === 12) hour24 = 0;
  
  // Subtract 2 hours
  let weighInHour = hour24 - 2;
  
  // Handle day wrap
  if (weighInHour < 0) weighInHour += 24;
  
  // Convert back to 12 hour format
  let weighInPeriod = 'AM';
  if (weighInHour >= 12) {
    weighInPeriod = 'PM';
    if (weighInHour > 12) weighInHour -= 12;
  }
  if (weighInHour === 0) weighInHour = 12;
  
  return `${weighInHour}:${minutes.toString().padStart(2, '0')} ${weighInPeriod}`;
}

function SessionView({ session, letterFilter, timeZone }: { session: Session; letterFilter: string; timeZone: string }) {
  const router = useRouter();
  const platformColors = getPlatformColors();
  const { currentTheme } = useTheme();
  
  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
  };

  // Filter platforms based on letterFilter
  const filteredPlatforms = letterFilter 
    ? session.platforms.filter(platform => platform.weightClass.slice(-1) === letterFilter)
    : session.platforms;
  
  const handlePlatformPress = (platform: Platform) => {
    router.push({
      pathname: '/(screens)/schedule-details',
      params: {
        id: `${session.id}-${platform.platform}`,
        sessionNumber: session.number,
        platform: platform.platform,
        weightClass: platform.weightClass,
        startTime: session.startTime,
        weighInTime: session.weighInTime,
      },
    });
  };
  
  if (filteredPlatforms.length === 0) return null;
  
  return (
    <View style={[styles.sessionContainer, { backgroundColor: colors.card }]}>
      <ThemedText style={[styles.sessionTitle, { color: colors.text }]}>
        Session {session.number}
      </ThemedText>
      
      <View style={[styles.platformsContainer, { backgroundColor: colors.card }]}>
        {filteredPlatforms.map((platform, index) => (
          <Pressable
            key={platform.platform}
            style={({ pressed }) => [
              styles.platformCard,
              { backgroundColor: colors.card },
              index < filteredPlatforms.length - 1 && [
                styles.platformCardBorder,
                { borderBottomColor: colors.border }
              ],
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => handlePlatformPress(platform)}
          >
            <View style={styles.platformContent}>
              <View style={[
                styles.platformIndicator,
                { backgroundColor: platformColors[platform.platform] }
              ]}>
                <ThemedText style={styles.platformText}>
                  {platform.platform}
                </ThemedText>
              </View>
              <View style={styles.platformInfo}>
                <ThemedText style={[styles.weightClassText, { color: colors.secondaryText }]}>
                  {platform.weightClass}
                </ThemedText>
                <ThemedText style={[styles.platformTimeText, { color: colors.secondaryText }]}>
                  Start: {platform.platformStartTime || session.startTime} {timeZone}
                </ThemedText>
              </View>
            </View>
            <IconSymbol 
              name="chevron.right" 
              size={20} 
              color={colors.secondaryText}
            />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function DayView({ day, letterFilter, timeZone }: { day: DaySchedule; letterFilter: string; timeZone: string }) {
  const { selectedMeet } = useSelectedMeet();
  const [refreshing, setRefreshing] = useState(false);
  const [syncManager] = useState(() => new SyncManager(selectedMeet));
  const { currentTheme } = useTheme();

  const colors = {
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncManager.forceSync();
    } catch (error) {
      console.error('Refresh failed:', error);
    } finally {
      setRefreshing(false);
    }
  }, [syncManager]);

  const filteredSessions = useMemo(() => {
    if (!letterFilter) return day.sessions;
    return day.sessions.filter(session => 
      session.platforms.some(platform => 
        platform.weightClass.slice(-1) === letterFilter
      )
    );
  }, [day.sessions, letterFilter]);

  return (
    <FlatList
      data={filteredSessions}
      keyExtractor={item => item.id}
      renderItem={({ item }) => (
        <SessionView 
          session={item} 
          letterFilter={letterFilter}
          timeZone={timeZone}
        />
      )}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.text}
        />
      }
      ListEmptyComponent={() => (
        <View style={styles.emptyContainer}>
          <ThemedText style={styles.emptyText}>
            No {letterFilter} sessions found
          </ThemedText>
        </View>
      )}
    />
  );
}

type Colors = {
  background: string;
  card: string;
  border: string;
  text: string;
  secondaryText: string;
  pressed: string;
};

export default function ScheduleScreen() {
  const { width } = useWindowDimensions();
  const navigation = useNavigation();
  const { selectedMeet, isLoading: isMeetLoading } = useSelectedMeet();
  const [syncManager] = useState(() => new SyncManager(selectedMeet));
  const [schedule, setSchedule] = useState<Schedule>([]);
  const [isLoading, setIsLoading] = useState(true);
  const meetConfig = useMemo(() => getMeetConfig(selectedMeet), [selectedMeet]);
  const [currentDate, setCurrentDate] = useState(() => schedule[0]?.date || '');
  const [letterFilter, setLetterFilter] = useState('');
  const [showFilterModal, setShowFilterModal] = useState(false);
  const { currentTheme } = useTheme();
  const [currentPage, setCurrentPage] = useState(0);

  const colors: Colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
  };

  useEffect(() => {
    const initializeAndLoad = async () => {
      setIsLoading(true);
      try {
        // Initialize store first
        await initStore();
        
        // Try to get data from sync manager
        const meetData = await syncManager.getMeetData();
        if (meetData.schedule) {
          setSchedule(meetData.schedule);
        } else {
          // Fallback to default schedule if no offline data
          const defaultSchedule = getSchedule(selectedMeet);
          setSchedule(defaultSchedule);
        }
      } catch (error) {
        console.error('Failed to load schedule:', error);
        // Fallback to default schedule on error
        const defaultSchedule = getSchedule(selectedMeet);
        setSchedule(defaultSchedule);
      } finally {
        setIsLoading(false);
      }
    };

    initializeAndLoad();
  }, [selectedMeet, syncManager]);

  // Extract unique letters from all weight classes
  const filterOptions = useMemo(() => {
    const letterSet = new Set<string>();
    schedule.forEach((day: DaySchedule) => {
      day.sessions.forEach((session: Session) => {
        session.platforms.forEach((platform: Platform) => {
          const lastChar = platform.weightClass.slice(-1);
          if (/^[A-G]$/.test(lastChar)) {
            letterSet.add(lastChar);
          }
        });
      });
    });
    return Array.from(letterSet).sort();
  }, [schedule]);

  const onViewableItemsChanged = useCallback(({ viewableItems }: {
    viewableItems: ViewToken[];
    changed: ViewToken[];
  }) => {
    if (viewableItems.length > 0) {
      const currentItem = viewableItems[0].item as DaySchedule;
      setCurrentDate(currentItem.date);
      navigation.setOptions({
        title: currentItem.date
      });
    }
  }, [navigation]);

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50
  }).current;

  const handleFilterSelect = (letter: string) => {
    setLetterFilter(letter);
    setShowFilterModal(false);
  };

  const handlePageChange = useCallback((index: number) => {
    setCurrentPage(index);
    flatListRef.current?.scrollToIndex({ index, animated: true });
  }, []);

  const flatListRef = useRef<FlatList>(null);

  const onScroll = useCallback((event: any) => {
    const newPage = Math.round(event.nativeEvent.contentOffset.x / width);
    setCurrentPage(newPage);
  }, [width]);

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.filterContainer, { 
        backgroundColor: colors.background,
        borderBottomColor: currentTheme === 'dark' ? '#2C2C2E' : '#C6C6C8',
        borderBottomWidth: 1,
      }]}>
        <View style={styles.filterRow}>
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
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ThemedText>Loading schedule...</ThemedText>
        </View>
      ) : (
        <View style={styles.contentContainer}>
          <FlatList
            ref={flatListRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            data={schedule}
            keyExtractor={item => item.date}
            renderItem={({ item }) => (
              <View style={[styles.pageContainer, { width }]}>
                <DayView 
                  day={item} 
                  letterFilter={letterFilter} 
                  timeZone={meetConfig.time.timeZone}
                />
              </View>
            )}
            getItemLayout={(data, index) => ({
              length: width,
              offset: width * index,
              index,
            })}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            onScroll={onScroll}
            scrollEventThrottle={16}
            contentContainerStyle={styles.flatListContent}
          />

          <PageIndicator 
            count={schedule.length}
            currentPage={currentPage}
            onPageChange={handlePageChange}
          />
        </View>
      )}

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
  pageContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  sessionContainer: {
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
  sessionTitle: {
    fontSize: 17,
    fontWeight: '600',
    padding: 16,
    paddingBottom: 4,
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
  platformsContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    overflow: 'hidden',
    margin: 16,
    marginTop: 0,
  },
  platformCard: {
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  platformCardBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E1E1E1',
  },
  platformCardPressed: {
    backgroundColor: '#F5F5F5',
  },
  platformContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginRight: 12,
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
  platformInfo: {
    flex: 1,
    marginLeft: 8,
  },
  platformTimeText: {
    fontSize: 13,
    marginTop: 2,
  },
  weightClassText: {
    fontSize: 15,
  },
  filterContainer: {
    padding: 16,
  },
  filterRow: {
    width: '100%',
  },
  filterButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    elevation: 1,
  },
  filterButtonText: {
    fontSize: 15,
    fontWeight: '600',
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
    borderBottomColor: '#E1E1E1',
  },
  modalOptionSelected: {
    backgroundColor: '#F5F5F5',
  },
  modalOptionPressed: {
    opacity: 0.8,
  },
  modalOptionText: {
    fontSize: 17,
    color: '#000000',
  },
  modalOptionTextSelected: {
    color: '#007AFF',
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
  contentContainer: {
    flex: 1,
    position: 'relative',
  },
  flatListContent: {
    paddingBottom: 100,
  },
  syncInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
}); 