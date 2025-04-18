import { StyleSheet, View, FlatList, Dimensions, useWindowDimensions, ViewToken, ScrollView, Pressable, Modal, RefreshControl, Alert, Platform, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useRef, useState, useMemo, useEffect } from 'react';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { SyncManager } from '@/lib/database/sync-manager';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { getPlatformColors } from '@/constants/Colors';
import { Session, Platform as PlatformType, DaySchedule, Schedule } from '@/types/schedule';
import { useTheme } from '@/contexts/ThemeContext';
import { PageIndicator } from '../../components/PageIndicator';
import { useSelectedMeet } from '@/contexts/SelectedMeetContext';
import { initStore } from '@/lib/database/offline-store';
import { MeetName } from '@/data/types/meet';

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
  
  const handlePlatformPress = (platform: PlatformType) => {
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

function DayView({ day, letterFilter, timeZone, onRefreshComplete }: { 
  day: DaySchedule; 
  letterFilter: string; 
  timeZone: string;
  onRefreshComplete?: () => void;
}) {
  const { selectedMeet } = useSelectedMeet();
  const [refreshing, setRefreshing] = useState(false);
  const [syncManager, setSyncManager] = useState<SyncManager | null>(null);
  const { currentTheme } = useTheme();
  const [scheduleData, setScheduleData] = useState(day);

  // Get time zone abbreviation
  const timeZoneAbbreviation = useMemo(() => {
    if (!selectedMeet) return 'Local';
    const date = new Date();
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone,
      timeZoneName: 'short'
    }).formatToParts(date).find(part => part.type === 'timeZoneName')?.value || 'Local';
  }, [selectedMeet, timeZone]);

  // Initialize sync manager when selectedMeet changes
  useEffect(() => {
    if (selectedMeet && typeof selectedMeet === 'string') {
      const manager = new SyncManager(selectedMeet);
      setSyncManager(manager);
      
      // Load schedule data immediately when sync manager is created
      const loadData = async () => {
        setRefreshing(true);
        try {
          const meetData = await manager.getMeetData();
          setScheduleData(meetData.schedule?.find(d => d.date === day.date) || day);
        } catch (error) {
          console.error('Error loading schedule:', error);
          setScheduleData(day);
        } finally {
          setRefreshing(false);
        }
      };
      
      loadData();
    } else {
      setSyncManager(null);
      setScheduleData(day);
    }
  }, [selectedMeet, day.date]);

  const colors = {
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
  };

  const onRefresh = useCallback(async () => {
    if (!syncManager) return;

    setRefreshing(true);
    try {
      const meetData = await syncManager.getMeetData();
      if (meetData.schedule) {
        // Find and update the current day's data
        const updatedDay = meetData.schedule.find(d => d.date === day.date);
        if (updatedDay) {
          setScheduleData(updatedDay);
        }
      }
      // Notify parent component to reload full schedule
      onRefreshComplete?.();
    } catch (error) {
      console.error('Refresh failed:', error);
    } finally {
      setRefreshing(false);
    }
  }, [syncManager, day.date, onRefreshComplete]);

  const filteredSessions = useMemo(() => {
    if (!letterFilter) return scheduleData.sessions;
    return scheduleData.sessions.filter(session => 
      session.platforms.some(platform => 
        platform.weightClass.slice(-1) === letterFilter
      )
    );
  }, [scheduleData.sessions, letterFilter]);

  return (
    <FlatList
      data={filteredSessions}
      keyExtractor={item => item.id}
      renderItem={({ item }) => (
        <SessionView 
          session={item} 
          letterFilter={letterFilter}
          timeZone={timeZoneAbbreviation}
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
  const { selectedMeet, meetDetails, isLoading: isMeetLoading, setSelectedMeet, availableMeets } = useSelectedMeet();
  const [syncManager, setSyncManager] = useState<SyncManager | null>(null);
  const [schedule, setSchedule] = useState<Schedule>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isChangingMeet, setIsChangingMeet] = useState(false);
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

  // Initialize sync manager when selectedMeet changes
  useEffect(() => {
    if (selectedMeet && typeof selectedMeet === 'string') {
      const manager = new SyncManager(selectedMeet);
      setSyncManager(manager);
      
      // Load schedule data immediately when sync manager is created
      const loadData = async () => {
        setIsLoading(true);
        try {
          const meetData = await manager.getMeetData();
          if (meetData?.schedule) {  // Use optional chaining
            setSchedule(meetData.schedule);
          } else {
            console.log('No schedule data in meet data');
            setSchedule([]);
          }
        } catch (error) {
          console.error('Error loading schedule:', error);
          setSchedule([]);
        } finally {
          setIsLoading(false);
        }
      };
      
      loadData();
    } else {
      setSyncManager(null);
      setSchedule([]);
    }
  }, [selectedMeet]);

  // Add a refresh handler for manual refreshes
  const handleRefresh = useCallback(async () => {
    if (!syncManager) return;
    
    setIsLoading(true);
    try {
      const meetData = await syncManager.getMeetData();
      if (meetData?.schedule) {  // Use optional chaining
        setSchedule(meetData.schedule);
      }
    } catch (error) {
      console.error('Error refreshing schedule:', error);
    } finally {
      setIsLoading(false);
    }
  }, [syncManager]);

  // Extract unique letters from all weight classes
  const filterOptions = useMemo(() => {
    const letterSet = new Set<string>();
    schedule.forEach((day: DaySchedule) => {
      day.sessions.forEach((session: Session) => {
        session.platforms.forEach((platform: PlatformType) => {
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

  // Update the renderDayView to use handleRefresh
  const renderDayView = useCallback(({ item }: { item: DaySchedule }) => (
    <View style={[styles.pageContainer, { width }]}>
      <DayView 
        day={item} 
        letterFilter={letterFilter} 
        timeZone={meetDetails?.time.timeZoneIdentifier || 'America/New_York'}
        onRefreshComplete={handleRefresh}
      />
    </View>
  ), [width, letterFilter, meetDetails, handleRefresh]);

  if (isMeetLoading) {
    return (
      <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.text} />
          <ThemedText style={[styles.loadingText, { color: colors.text, marginTop: 12 }]}>
            Loading meets...
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (!selectedMeet || !meetDetails) {
    return (
      <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ThemedText style={[styles.loadingText, { color: colors.text }]}>
            Please select a meet to view the schedule
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (isLoading || isChangingMeet) {
    return (
      <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.text} />
          <ThemedText style={[styles.loadingText, { color: colors.text, marginTop: 12 }]}>
            Loading schedule...
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

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
            <View>
              <ThemedText style={[styles.filterButtonText, { color: colors.text }]}>
                Selected Meet
              </ThemedText>
              <ThemedText style={[styles.meetValue, { color: colors.secondaryText }]}>
                {selectedMeet}
              </ThemedText>
            </View>
            <IconSymbol name="chevron.down" size={12} color={colors.secondaryText} />
          </Pressable>
        </View>
      </View>

      {!schedule || schedule.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.loadingContainer}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={() => {}}
              tintColor={colors.text}
            />
          }
        >
          <ThemedText style={[styles.loadingText, { color: colors.text }]}>
            No schedule data available
          </ThemedText>
          <ThemedText style={[styles.loadingText, { color: colors.secondaryText, marginTop: 8, fontSize: 14 }]}>
            Pull down to refresh
          </ThemedText>
        </ScrollView>
      ) : (
        <View style={styles.contentContainer}>
          <FlatList
            ref={flatListRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            data={schedule}
            keyExtractor={item => item.date}
            renderItem={renderDayView}
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

          {schedule.length > 0 && (
            <PageIndicator 
              count={schedule.length}
              currentPage={currentPage}
              onPageChange={handlePageChange}
            />
          )}
        </View>
      )}

      <Modal
        visible={showFilterModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFilterModal(false)}
      >
        <Pressable 
          style={[
            styles.modalOverlay,
            { backgroundColor: currentTheme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.4)' }
          ]}
          onPress={() => setShowFilterModal(false)}
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
                onPress={() => setShowFilterModal(false)}
              >
                <IconSymbol 
                  name={Platform.OS === 'ios' ? 'xmark' : 'close'}
                  size={20} 
                  color={colors.secondaryText} 
                />
              </Pressable>
            </View>
            
            {availableMeets.map((meet) => (
              <Pressable
                key={meet.name}
                style={({ pressed }) => [
                  styles.modalOption,
                  { borderBottomColor: colors.border },
                  selectedMeet === meet.name && { backgroundColor: colors.pressed },
                  pressed && { opacity: 0.8 }
                ]}
                onPress={async () => {
                  setShowFilterModal(false);
                  if (meet.name === selectedMeet) return;
                  setIsChangingMeet(true);
                  try {
                    await setSelectedMeet(meet.name);
                  } catch (error) {
                    console.error('Error saving selected meet:', error);
                    Alert.alert('Error', 'Failed to update selected meet.');
                  } finally {
                    setIsChangingMeet(false);
                  }
                }}
              >
                <ThemedText style={[
                  styles.modalOptionText,
                  { color: colors.text },
                  selectedMeet === meet.name && { color: '#007AFF' }
                ]}>
                  {meet.name}
                </ThemedText>
                {selectedMeet === meet.name && (
                  <IconSymbol name="checkmark" size={16} color="#007AFF" />
                )}
              </Pressable>
            ))}
            
            {availableMeets.length === 0 && (
              <View style={styles.emptyContainer}>
                <ThemedText style={styles.emptyText}>
                  No meets available
                </ThemedText>
              </View>
            )}
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
    justifyContent: 'space-between',
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
    marginHorizontal: 16,
  },
  modalHeader: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    position: 'relative',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  closeButton: {
    position: 'absolute',
    right: 16,
    top: 16,
    padding: 4,
    zIndex: 1,
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
  meetValue: {
    fontSize: 15,
    marginTop: 2,
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
  loadingText: {
    fontSize: 16,
    textAlign: 'center',
  },
}); 