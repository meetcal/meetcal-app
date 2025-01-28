import { StyleSheet, View, FlatList, Dimensions, useWindowDimensions, ViewToken, ScrollView, Pressable, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useRef, useState, useMemo } from 'react';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { IconSymbol } from '@/components/ui/IconSymbol';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { schedule, getPlatformColors } from '@/data/schedule';
import { Session, Platform, DaySchedule } from '@/types/schedule';

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

function SessionView({ session, letterFilter }: { session: Session; letterFilter: string }) {
  const router = useRouter();
  const platformColors = getPlatformColors();
  
  // Filter platforms based on letterFilter
  const filteredPlatforms = letterFilter 
    ? session.platforms.filter(platform => platform.weightClass.endsWith(letterFilter))
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
  
  // Only render if there are platforms to show
  if (filteredPlatforms.length === 0) return null;
  
  return (
    <View style={styles.sessionContainer}>
      <ThemedText style={styles.sessionTitle}>Session {session.number}</ThemedText>
      <View style={styles.timeContainer}>
        <View style={styles.timeRow}>
          <View style={styles.timeBlock}>
            <ThemedText style={styles.timeLabel}>Weigh-in:</ThemedText>
            <ThemedText style={styles.timeText}>{session.weighInTime}</ThemedText>
          </View>
          <View style={styles.timeSeparator} />
          <View style={styles.timeBlock}>
            <ThemedText style={styles.timeLabel}>Start:</ThemedText>
            <ThemedText style={styles.timeText}>{session.startTime}</ThemedText>
          </View>
        </View>
      </View>
      
      <View style={styles.platformsContainer}>
        {filteredPlatforms.map((platform, index) => (
          <Pressable
            key={platform.platform}
            style={({ pressed }) => [
              styles.platformCard,
              index < filteredPlatforms.length - 1 && styles.platformCardBorder,
              pressed && styles.platformCardPressed,
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
              <ThemedText style={styles.weightClassText}>
                {platform.weightClass}
              </ThemedText>
            </View>
            <IconSymbol 
              name="chevron.right" 
              size={20} 
              color="#C7C7CC"
            />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function DayView({ day, letterFilter }: { day: DaySchedule; letterFilter: string }) {
  const filteredSessions = useMemo(() => {
    if (!letterFilter) return day.sessions;
    return day.sessions.filter(session => 
      session.platforms.some(platform => 
        platform.weightClass.endsWith(letterFilter)
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
        />
      )}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
      ListEmptyComponent={() => (
        <View style={styles.emptyContainer}>
          <ThemedText style={styles.emptyText}>
            No sessions found for Group {letterFilter}
          </ThemedText>
        </View>
      )}
    />
  );
}

export default function ScheduleScreen() {
  const { width } = useWindowDimensions();
  const navigation = useNavigation();
  const [currentDate, setCurrentDate] = useState(schedule[0].date);
  const [letterFilter, setLetterFilter] = useState('');
  const [showFilterModal, setShowFilterModal] = useState(false);

  // Extract unique letters from all weight classes
  const filterOptions = useMemo(() => {
    const letterSet = new Set<string>();
    schedule.forEach(day => {
      day.sessions.forEach(session => {
        session.platforms.forEach(platform => {
          const letter = platform.weightClass.split(' ')[1];
          if (letter) letterSet.add(letter);
        });
      });
    });
    return Array.from(letterSet).sort();
  }, []);

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

  return (
    <ThemedView style={styles.container}>
      <View style={styles.filterContainer}>
        <Pressable
          style={({ pressed }) => [
            styles.filterButton,
            pressed && styles.filterButtonPressed,
          ]}
          onPress={() => setShowFilterModal(true)}
        >
          <ThemedText style={styles.filterButtonText}>
            {letterFilter ? `Group ${letterFilter}` : 'All Groups'}
          </ThemedText>
          <IconSymbol name="chevron.down" size={12} color="#666666" />
        </Pressable>
      </View>

      <FlatList
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        data={schedule}
        keyExtractor={item => item.date}
        renderItem={({ item }) => (
          <View style={[styles.pageContainer, { width }]}>
            <DayView day={item} letterFilter={letterFilter} />
          </View>
        )}
        getItemLayout={(data, index) => ({
          length: width,
          offset: width * index,
          index,
        })}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
      />

      <Modal
        visible={showFilterModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFilterModal(false)}
      >
        <Pressable 
          style={styles.modalOverlay}
          onPress={() => setShowFilterModal(false)}
        >
          <View style={styles.modalContent}>
            <Pressable
              style={({ pressed }) => [
                styles.modalOption,
                letterFilter === '' && styles.modalOptionSelected,
                pressed && styles.modalOptionPressed,
              ]}
              onPress={() => handleFilterSelect('')}
            >
              <ThemedText style={[
                styles.modalOptionText,
                letterFilter === '' && styles.modalOptionTextSelected,
              ]}>
                All Groups
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
                  letterFilter === letter && styles.modalOptionSelected,
                  pressed && styles.modalOptionPressed,
                ]}
                onPress={() => handleFilterSelect(letter)}
              >
                <ThemedText style={[
                  styles.modalOptionText,
                  letterFilter === letter && styles.modalOptionTextSelected,
                ]}>
                  Group {letter}
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
    backgroundColor: '#F5F5F5',
  },
  pageContainer: {
    flex: 1,
  },
  scrollContent: {
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
    backgroundColor: '#FFFFFF',
  },
  platformCardBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E1E1E1',
  },
  platformCardPressed: {
    backgroundColor: '#F5F5F5',
  },
  platformContent: {
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
}); 