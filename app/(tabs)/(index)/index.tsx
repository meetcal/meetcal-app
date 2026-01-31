import { StyleSheet, View, FlatList, useWindowDimensions, ViewToken, ScrollView, Pressable, Modal, RefreshControl, Alert, Platform, Animated, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useNavigation, useRouter } from 'expo-router';
import { useCallback, useRef, useState, useMemo, useEffect, useLayoutEffect } from 'react';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { SyncManager } from '@/lib/database/sync-manager';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { getPlatformColors } from '@/constants/Colors';
import { Session, Platform as PlatformType, DaySchedule, Schedule } from '@/types/schedule';
import { useTheme } from '@/contexts/ThemeContext';
import { PageIndicator } from '@/components/PageIndicator';
import { useSelectedMeet } from '@/contexts/SelectedMeetContext';
import { initStore, getMeetData, saveMeetSchedule } from '@/lib/database/offline-store';
import { fetchSchedule } from '@/lib/database/queries';
import { MeetName } from '@/data/types/meet';
import { VersionAnnouncement } from '@/components/VersionAnnouncement';
import { useAuth } from '@clerk/clerk-expo';

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

  // Custom sort order for platforms
  const platformSortOrder = ['Red', 'White', 'Blue', 'Stars', 'Stripes', 'Rogue'];
  const sortedPlatforms = [...filteredPlatforms].sort((a, b) => {
    const idxA = platformSortOrder.indexOf(a.platform);
    const idxB = platformSortOrder.indexOf(b.platform);
    // If not found, push to end
    return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
  });

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
  
  if (sortedPlatforms.length === 0) return null;
  
  return (
    <View style={[styles.sessionContainer, { backgroundColor: colors.card }]}>
      <ThemedText style={[styles.sessionTitle, { color: colors.text }]}>
        Session {session.number}
      </ThemedText>
      
      <View style={[styles.platformsContainer, { backgroundColor: colors.card }]}> 
        {sortedPlatforms.map((platform, index) => (
          <Pressable
            key={platform.platform}
            style={({ pressed }) => [
              styles.platformCard,
              { backgroundColor: colors.card },
              index < sortedPlatforms.length - 1 && [
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
  const { selectedMeet, meetDetails, isLoading: isMeetLoading, setSelectedMeet, availableMeets, refreshAvailableMeets } = useSelectedMeet();
  const [schedule, setSchedule] = useState<Schedule>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isChangingMeet, setIsChangingMeet] = useState(false);
  const [currentDate, setCurrentDate] = useState(() => schedule[0]?.date || '');
  const [letterFilter, setLetterFilter] = useState('');
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [isRefreshingMeets, setIsRefreshingMeets] = useState(false);
  const { currentTheme } = useTheme();
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const headerColors = {
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
  };
  const colors: Colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
  };
  const [currentPage, setCurrentPage] = useState(0);
  const [initialScrollIndex, setInitialScrollIndex] = useState(0);
  const skeletonPulse = useRef(new Animated.Value(0.4)).current;

  const upcomingMeets = useMemo(() => {
    const getDateInTimeZone = (timeZone: string) => {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      }).formatToParts(new Date());
      const year = Number(parts.find(part => part.type === 'year')?.value ?? '0');
      const month = Number(parts.find(part => part.type === 'month')?.value ?? '1');
      const day = Number(parts.find(part => part.type === 'day')?.value ?? '1');
      return new Date(year, month - 1, day);
    };

    const startOfToday = getDateInTimeZone('America/Los_Angeles');
    const threeMonthsBefore = new Date(startOfToday);
    const threeMonthsAfter = new Date(startOfToday);
    threeMonthsBefore.setMonth(threeMonthsBefore.getMonth() - 3);
    threeMonthsAfter.setMonth(threeMonthsAfter.getMonth() + 3);

    return availableMeets.filter((meet) => {
      const start = new Date(meet.dates?.start ?? '');
      const end = new Date(meet.dates?.end ?? meet.dates?.start ?? '');
      if (Number.isNaN(start.getTime())) return false;
      const endDate = Number.isNaN(end.getTime()) ? start : end;
      return endDate >= threeMonthsBefore && start <= threeMonthsAfter;
    });
  }, [availableMeets]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable
            style={styles.headerIconButton}
            onPress={() => {
              if (isSignedIn) {
                router.push('/(screens)/profile');
              } else {
                router.push({
                  pathname: '/(auth)/sign-in',
                  params: { from: 'info' }
                });
              }
            }}
            accessibilityRole="button"
            accessibilityLabel={isSignedIn ? 'My profile and settings' : 'Sign in'}
          >
            <IconSymbol name={Platform.OS === 'ios' ? "person.circle.fill" : "person-circle-sharp"} size={24} color={headerColors.text} />
          </Pressable>
        </View>
      ),
    });
  }, [headerColors.text, isSignedIn, navigation, router]);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(skeletonPulse, {
          toValue: 0.9,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(skeletonPulse, {
          toValue: 0.4,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [skeletonPulse]);

  const SkeletonBlock = useCallback(({ style }: { style: any }) => {
    const backgroundColor = currentTheme === 'dark' ? '#2C2C2E' : '#E6E6EA';
    return (
      <Animated.View
        style={[
          styles.skeletonBlock,
          { backgroundColor, opacity: skeletonPulse },
          style,
        ]}
      />
    );
  }, [currentTheme, skeletonPulse]);

  const renderLoadingSkeleton = useCallback((label: string) => (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.filterContainer, { 
        backgroundColor: colors.background,
        borderBottomColor: currentTheme === 'dark' ? '#2C2C2E' : '#C6C6C8',
        borderBottomWidth: 1,
      }]}>
        <View style={styles.filterRow}>
          <View style={[styles.filterButton, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.filterTextContainer}>
              <SkeletonBlock style={styles.skeletonLineShort} />
              <SkeletonBlock style={styles.skeletonLine} />
            </View>
            <SkeletonBlock style={styles.skeletonIcon} />
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.skeletonContent}>
        {[0, 1, 2].map((index) => (
          <View key={`skeleton-${index}`} style={[styles.sessionContainer, { backgroundColor: colors.card }]}>
            <View style={styles.skeletonSection}>
              <SkeletonBlock style={styles.skeletonTitle} />
              <SkeletonBlock style={styles.skeletonSubtitle} />
            </View>
            <View style={styles.skeletonTimeRow}>
              <SkeletonBlock style={styles.skeletonChip} />
              <SkeletonBlock style={styles.skeletonChip} />
            </View>
            <View style={[styles.platformsContainer, { backgroundColor: colors.card }]}>
              {[0, 1, 2].map((row) => (
                <View key={`platform-${index}-${row}`} style={styles.platformCard}>
                  <View style={styles.platformContent}>
                    <SkeletonBlock style={styles.skeletonBadge} />
                    <View style={styles.platformInfo}>
                      <SkeletonBlock style={styles.skeletonLine} />
                      <SkeletonBlock style={styles.skeletonLineShort} />
                    </View>
                  </View>
                  <SkeletonBlock style={styles.skeletonTiny} />
                </View>
              ))}
            </View>
          </View>
        ))}
        <ThemedText style={[styles.loadingText, { color: colors.secondaryText, marginTop: 12 }]}>
          {label}
        </ThemedText>
      </ScrollView>
    </ThemedView>
  ), [SkeletonBlock, colors, currentTheme]);

  // Function to calculate the initial page based on current UTC date
  const calculateInitialPage = useCallback((scheduleData: Schedule): number => {
    if (!scheduleData || scheduleData.length === 0) return 0;
    
    // Get current date in UTC and format as YYYY-MM-DD
    const currentUTCDate = new Date().toISOString().split('T')[0];
    
    // Find the index of the current date or the closest future date using fullDate
    const currentDateIndex = scheduleData.findIndex(day => day.fullDate >= currentUTCDate);
        
    // If current date is before all schedule dates, return 0 (first day)
    // If current date is after all schedule dates, return the last day
    // Otherwise, return the found index
    if (currentDateIndex === -1) {
      return scheduleData.length - 1; // Current date is after all schedule dates
    }
    
    return currentDateIndex;
  }, []);

  // Revised loadData function (Supabase-first, Cache-fallback)
  const loadData = useCallback(async (meet: MeetName) => {
    setIsLoading(true);
    let scheduleData: Schedule = [];
    let loadedFromCache = false;

    try {
      // 1. Try fetching from Supabase
      const freshSchedule = await fetchSchedule(meet);
      scheduleData = freshSchedule;
      // 2. Save successful fetch to cache (don't wait for it)
      if (freshSchedule.length > 0) {
        saveMeetSchedule(meet, freshSchedule).catch(err => 
          console.error(`ScheduleScreen: Failed to save fresh schedule to cache for ${meet}:`, err)
        );
      } else {
        console.log(`ScheduleScreen: Empty schedule from DB for ${meet}; skipping cache save`);
      }
    } catch (fetchError) {
      // 3. Fallback to cache if Supabase fetch fails
      try {
        const cachedMeetData = await getMeetData(meet);
        if (cachedMeetData?.schedule) {
          scheduleData = cachedMeetData.schedule;
          loadedFromCache = true;
        } else {
          console.log(`ScheduleScreen: No schedule found in cache for ${meet}`);
        }
      } catch (cacheError) {
        console.error(`ScheduleScreen: Failed to load schedule from cache for ${meet}:`, cacheError);
        Alert.alert('Error', 'Failed to load schedule data. Please check connection or try refreshing.');
      }
    }

    setSchedule(scheduleData); 
    
    // Calculate and set the initial page based on current UTC date
    if (scheduleData && scheduleData.length > 0) {
      const initialPage = calculateInitialPage(scheduleData);
      setInitialScrollIndex(initialPage);
      setCurrentPage(initialPage);
      setCurrentDate(scheduleData[initialPage]?.date || '');
    }
    
    // If loaded from cache, maybe show an indicator?
    // For now, just log it.
    if (loadedFromCache) {
        console.log("ScheduleScreen: Displaying data loaded from cache.");
    }
    setIsLoading(false);

  }, [calculateInitialPage]); // Dependencies managed by the calling useEffect

  // Load data when selectedMeet changes
  useEffect(() => {
    // Initialize store once
    initStore(); 

    if (selectedMeet && typeof selectedMeet === 'string') {
      // Ensure selectedMeet is treated as MeetName type
      loadData(selectedMeet as MeetName);
    } else {
      // Clear schedule if no meet is selected
      setSchedule([]);
      setIsLoading(false); 
    }
  }, [selectedMeet, loadData]);

  // Scroll to initial position after data is loaded
  useEffect(() => {
    if (!isLoading && schedule.length > 0 && initialScrollIndex > 0) {
      // Use a small delay to ensure the FlatList is fully rendered
      const timer = setTimeout(() => {
        flatListRef.current?.scrollToIndex({ 
          index: initialScrollIndex, 
          animated: false 
        });
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [isLoading, schedule.length, initialScrollIndex]);

  // Revised refresh handler
  const handleRefresh = useCallback(async () => {
    if (selectedMeet && typeof selectedMeet === 'string') {
      // Re-run the loadData logic on refresh
      await loadData(selectedMeet as MeetName); 
    } else {
      console.log("Refresh skipped: No meet selected");
    }
  }, [selectedMeet, loadData]);

  // Handle refreshing available meets in modal
  const handleRefreshMeets = useCallback(async () => {
    setIsRefreshingMeets(true);
    try {
      await refreshAvailableMeets();
    } catch (error) {
      console.error('Error refreshing meets:', error);
    } finally {
      setIsRefreshingMeets(false);
    }
  }, [refreshAvailableMeets]);

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

  const formatDayTitle = useCallback((day: DaySchedule) => {
    const sourceDate = day.fullDate || day.date;
    if (!sourceDate) return day.date;

    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sourceDate);
    if (isoMatch) {
      const year = Number(isoMatch[1]);
      const month = Number(isoMatch[2]);
      const dayOfMonth = Number(isoMatch[3]);
      const utcDate = new Date(Date.UTC(year, month - 1, dayOfMonth));
      return new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(utcDate);
    }

    const parsed = new Date(sourceDate);
    if (Number.isNaN(parsed.getTime())) return day.date;

    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    }).format(parsed);
  }, []);

  const onViewableItemsChanged = useCallback(({ viewableItems }: {
    viewableItems: ViewToken[];
    changed: ViewToken[];
  }) => {
    if (viewableItems.length > 0) {
      const currentItem = viewableItems[0].item as DaySchedule;
      setCurrentDate(currentItem.date);
      navigation.setOptions({
        title: formatDayTitle(currentItem)
      });
    }
  }, [formatDayTitle, navigation]);

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
    return renderLoadingSkeleton('Loading meets...');
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
    return renderLoadingSkeleton('Loading schedule...');
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
            <View style={styles.filterTextContainer}>
              <ThemedText style={[styles.filterButtonText, { color: colors.text }]}>
                Selected Meet
              </ThemedText>
              <ThemedText style={[styles.meetValue, { color: colors.secondaryText }]} numberOfLines={1} ellipsizeMode="tail">
                {selectedMeet}
              </ThemedText>
            </View>
            <IconSymbol name="chevron.down" size={12} color={colors.secondaryText} />
          </Pressable>
        </View>
      </View>

      <VersionAnnouncement />

      {!schedule || schedule.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyStateContainer}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={() => {}}
              tintColor={colors.text}
            />
          }
        >
          <Image
            source={require('@/assets/images/MeetCal-no-bg.png')}
            style={styles.emptyStateImage}
            resizeMode="contain"
          />
          <ThemedText style={[styles.emptyStateText, { color: colors.secondaryText }]}>
            No data has been loaded yet for this meet. Check back soon!
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
            initialScrollIndex={initialScrollIndex}
            getItemLayout={(data, index) => ({
              length: width,
              offset: width * index,
              index,
            })}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            onScroll={onScroll}
            scrollEventThrottle={16}
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
              <Pressable
                style={({ pressed }) => [
                  styles.refreshButton,
                  pressed && { opacity: 0.8 },
                  isRefreshingMeets && { opacity: 0.5 },
                ]}
                onPress={handleRefreshMeets}
                disabled={isRefreshingMeets}
              >
                <IconSymbol
                  name="arrow.clockwise"
                  size={18}
                  color={colors.secondaryText}
                />
              </Pressable>
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
            
            <ScrollView 
              style={styles.modalScrollView} 
              contentContainerStyle={styles.modalScrollContent}
              alwaysBounceVertical
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshingMeets}
                  onRefresh={handleRefreshMeets}
                  tintColor={colors.text}
                />
              }
            >
              {upcomingMeets.map((meet) => (
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
              
              {upcomingMeets.length === 0 && (
                <View style={styles.emptyContainer}>
                  <ThemedText style={styles.emptyText}>
                    No meets available in the next 6 months
                  </ThemedText>
                </View>
              )}
            </ScrollView>
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
    paddingBottom: 120
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
    paddingHorizontal: 4,
    paddingVertical: 4,
    width: 64,
    justifyContent: 'center',
    alignItems: 'center',
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
  filterTextContainer: {
    flex: 1,
    marginRight: 8,
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
    maxHeight: '70%',
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
  refreshButton: {
    position: 'absolute',
    left: 16,
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
    width: '90%',
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
  emptyStateContainer: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 24,
    gap: 16,
  },
  emptyStateText: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
  },
  emptyStateImage: {
    width: 144,
    height: 144,
  },
  contentContainer: {
    flex: 1,
    position: 'relative',
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
  skeletonContent: {
    padding: 16,
    paddingBottom: 40,
  },
  skeletonBlock: {
    borderRadius: 6,
  },
  skeletonSection: {
    padding: 16,
    paddingBottom: 8,
  },
  skeletonTitle: {
    height: 18,
    width: '60%',
    marginBottom: 10,
  },
  skeletonSubtitle: {
    height: 14,
    width: '40%',
  },
  skeletonLine: {
    height: 12,
    width: '75%',
  },
  skeletonLineShort: {
    height: 12,
    width: '45%',
    marginTop: 6,
  },
  skeletonIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  skeletonChip: {
    height: 12,
    width: 80,
    borderRadius: 6,
  },
  skeletonBadge: {
    width: 52,
    height: 22,
    borderRadius: 6,
  },
  skeletonTiny: {
    width: 24,
    height: 12,
    borderRadius: 6,
  },
  skeletonTimeRow: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    gap: 12,
  },
  modalScrollView: {
    flexGrow: 0,
  },
  modalScrollContent: {
    flexGrow: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIconButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
}); 
