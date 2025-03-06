import { useState, useEffect, useMemo } from 'react';
import { StyleSheet, View, FlatList, Pressable, LayoutAnimation, Modal, ScrollView, Dimensions, Alert, TextInput, Platform } from 'react-native';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { useTheme } from '@/contexts/ThemeContext';
import { LiftResult, liftingResults } from '@/data/athletes';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { schedule } from '@/data/schedule';
import * as Calendar from 'expo-calendar';
import { getFullLocation } from '@/config/venue';
import { useRouter } from 'expo-router';
import { useSavedSessions } from '@/contexts/SavedSessionsContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { liftingResults as liftingResultsData } from '@/data/results';

function getSessionDetails(sessionNumber: number) {
  for (const day of schedule) {
    const session = day.sessions.find(s => s.number === sessionNumber);
    if (session) {
      return {
        date: day.fullDate,
        startTime: session.startTime,
        weighInTime: session.weighInTime,
        displayDate: day.date
      };
    }
  }
  return null;
}

interface AthleteItemProps {
  athlete: LiftResult;
  isExpanded: boolean;
  onPress: () => void;
  router: ReturnType<typeof useRouter>;
}

function getLastYearBests(athleteName: string) {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  
  const athleteResults = liftingResultsData.filter(result => {
    const resultDate = new Date(result.date);
    return (
      result.lifter.toLowerCase() === athleteName.toLowerCase() &&
      resultDate >= oneYearAgo
    );
  });

  if (athleteResults.length === 0) {
    return { bestSnatch: 0, bestCJ: 0, bestTotal: 0 };
  }

  return {
    bestSnatch: Math.max(...athleteResults.map(r => r.snatch)),
    bestCJ: Math.max(...athleteResults.map(r => r.cj)),
    bestTotal: Math.max(...athleteResults.map(r => r.total))
  };
}

function AthleteItem({ athlete, isExpanded, onPress, router }: AthleteItemProps) {
  const { currentTheme } = useTheme();
  
  const colors = {
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
  };

    // Get the athlete's best lifts from the past year
    const yearBests = useMemo(() => 
      getLastYearBests(athlete.name),
      [athlete.name]
    );

  const handleSessionPress = () => {
    if (!athlete.session) return;

    const sessionDay = schedule.find(day => 
      day.sessions.some(s => s.number === athlete.session?.number)
    );
    
    const scheduleSession = sessionDay?.sessions.find(s => 
      s.number === athlete.session?.number
    );

    const platform = scheduleSession?.platforms.find(p => 
      p.platform === athlete.session?.platform
    );

    // Use platform-specific time if available
    const startTime = platform?.platformStartTime || getSessionDetails(athlete.session.number)?.startTime;
    const weighInTime = startTime ? calculateWeighInTime(startTime) : getSessionDetails(athlete.session.number)?.weighInTime;

    if (!sessionDay || !startTime || !weighInTime) return;

    router.push({
      pathname: '/(screens)/schedule-details',
      params: {
        id: `session-${athlete.session.number}-${athlete.session.platform}`,
        sessionNumber: athlete.session.number,
        platform: athlete.session.platform,
        weightClass: athlete.weightClass,
        startTime,
        weighInTime,
        date: sessionDay.fullDate,
        athleteName: athlete.name,
      }
    });
  };

  return (
    <View style={[styles.athleteCard, { backgroundColor: colors.card }]}>
      <Pressable
        style={({ pressed }) => [
          styles.athleteButton,
          pressed && { backgroundColor: colors.pressed }
        ]}
        onPress={onPress}
      >
        <ThemedText style={styles.athleteName}>{athlete.name}</ThemedText>
        <IconSymbol 
          name={getChevronIcon(isExpanded ? 'down' : 'right')} 
          size={20} 
          color={colors.secondaryText}
        />
      </Pressable>
      
      {isExpanded && (
        <View style={[styles.detailsContainer, { borderTopColor: colors.border }]}>
          {athlete.session && (
            <>
              <Pressable
                style={({ pressed }) => [
                  styles.detailRow,
                  styles.sessionLink,
                  pressed && { backgroundColor: colors.pressed }
                ]}
                onPress={handleSessionPress}
              >
                <ThemedText style={[styles.detailLabel, { color: colors.secondaryText }]}>
                  Session:
                </ThemedText>
                <View style={styles.sessionValueContainer}>
                  <ThemedText style={[styles.detailValue, { color: '#007AFF' }]}>
                    Session {athlete.session.number} • {athlete.session.platform} Platform
                  </ThemedText>
                  <IconSymbol 
                    name={getChevronIcon('right')} 
                    size={13} 
                    color="#007AFF" 
                  />
                </View>
              </Pressable>
              {getSessionDetails(athlete.session.number) && (
                <View style={styles.detailRow}>
                  <ThemedText style={[styles.detailLabel, { color: colors.secondaryText }]}>
                    Date & Time:
                  </ThemedText>
                  <ThemedText style={styles.detailValue}>
                    {getSessionDetails(athlete.session.number)?.displayDate} • {
                      schedule.find(day => 
                        day.sessions.some(s => s.number === athlete.session?.number)
                      )?.sessions.find(s => 
                        s.number === athlete.session?.number
                      )?.platforms.find(p => 
                        p.platform === athlete.session?.platform
                      )?.platformStartTime || getSessionDetails(athlete.session.number)?.startTime
                    }
                  </ThemedText>
                </View>
              )}
            </>
          )}
          <View style={[styles.detailRow, styles.wrappingDetailRow]}>
            <ThemedText style={[styles.detailLabel, { color: colors.secondaryText }]}>
              Club:
            </ThemedText>
            <View style={styles.wrappingDetailValue}>
              <ThemedText style={[styles.detailValue, styles.wrappingText]}>
                {athlete.club}
              </ThemedText>
            </View>
          </View>
          <View style={styles.detailRow}>
            <ThemedText style={[styles.detailLabel, { color: colors.secondaryText }]}>
              Weight Class:
            </ThemedText>
            <ThemedText style={styles.detailValue}>{athlete.weightClass}</ThemedText>
          </View>
          <View style={styles.detailRow}>
            <ThemedText style={[styles.detailLabel, { color: colors.secondaryText }]}>
              Entry Total:
            </ThemedText>
            <ThemedText style={styles.detailValue}>{athlete.entryTotal}kg</ThemedText>
          </View>

          <View style={[styles.statsContainer, { borderTopColor: colors.border }]}>
            <ThemedText style={[styles.statsTitle, { color: colors.secondaryText }]}>
              Bests From The Last Year
            </ThemedText>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <ThemedText style={[styles.statLabel, { color: colors.secondaryText }]}>
                  Snatch
                </ThemedText>
                <ThemedText style={styles.statValue}>
                  {yearBests.bestSnatch > 0 ? `${yearBests.bestSnatch}kg` : '—'}
                </ThemedText>
              </View>
              <View style={styles.statItem}>
                <ThemedText style={[styles.statLabel, { color: colors.secondaryText }]}>
                  CJ
                </ThemedText>
                <ThemedText style={styles.statValue}>
                  {yearBests.bestCJ > 0 ? `${yearBests.bestCJ}kg` : '—'}
                </ThemedText>
              </View>
              <View style={styles.statItem}>
                <ThemedText style={[styles.statLabel, { color: colors.secondaryText }]}>
                  Total
                </ThemedText>
                <ThemedText style={styles.statValue}>
                  {yearBests.bestTotal > 0 ? `${yearBests.bestTotal}kg` : '—'}
                </ThemedText>
              </View>
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.meetResultsButton,
              pressed && { opacity: 0.8 }
            ]}
            onPress={() => router.push({
              pathname: '/(screens)/athlete-results',
              params: { name: athlete.name }
            })}
          >
            <ThemedText style={styles.meetResultsText}>
              See All Meet Results
            </ThemedText>
            <IconSymbol 
              name={getChevronIcon('right')} 
              size={13} 
              color="#007AFF"
            />
          </Pressable>
        </View>
      )}
    </View>
  );
}

function sortWeightClasses(a: string, b: string): number {
  // First split by gender
  const aIsFemale = a.startsWith('Female');
  const bIsFemale = b.startsWith('Female');
  
  if (aIsFemale && !bIsFemale) return -1;
  if (!aIsFemale && bIsFemale) return 1;
  
  // Extract numeric values for comparison
  const aNum = parseInt(a.match(/\d+/)?.[0] || '0');
  const bNum = parseInt(b.match(/\d+/)?.[0] || '0');
  
  // If numbers are different, sort by number
  if (aNum !== bNum) return aNum - bNum;
  
  // If numbers are the same, put the + version after the regular version
  const aHasPlus = a.includes('+');
  const bHasPlus = b.includes('+');
  
  if (aHasPlus && !bHasPlus) return 1;
  if (!aHasPlus && bHasPlus) return -1;
  
  return 0;
}

function sortAthletes(a: LiftResult, b: LiftResult): number {
  return a.name.localeCompare(b.name);
}

async function requestCalendarPermissions() {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  return status === 'granted';
}

// Helper function to parse time string (same as in schedule-details.tsx)
function parseTimeString(timeStr: string, dateStr: string) {
  const [time, period] = timeStr.split(' ');
  const [hours, minutes] = time.split(':').map(Number);
  
  let adjustedHours = hours;
  if (period === 'PM' && hours !== 12) {
    adjustedHours += 12;
  } else if (period === 'AM' && hours === 12) {
    adjustedHours = 0;
  }

  const [year, month, day] = dateStr.split('-').map(Number);
  
  // Create Date object in UTC, adding 5 hours for EST
  return new Date(Date.UTC(year, month - 1, day, adjustedHours + 5, minutes));
}

async function createCalendarEvents(sessions: Array<{
  date: string;
  startTime: string;
  weighInTime: string;
  sessionNumber: string;
  platform: string;
  weightClass: string;
}>) {
  try {
    let calendarId;

    if (Platform.OS === 'ios') {
      const calendar = await Calendar.getDefaultCalendarAsync();
      calendarId = calendar.id;
    } else {
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const primaryCalendar = calendars.find(cal => 
        cal.accessLevel === Calendar.CalendarAccessLevel.OWNER && 
        cal.allowsModifications
      );

      if (!primaryCalendar) {
        throw new Error('no_calendar');
      }

      calendarId = primaryCalendar.id;
    }

    for (const session of sessions) {
      // Find session in schedule to get platform-specific time
      const sessionDay = schedule.find(day => 
        day.sessions.some(s => s.number === Number(session.sessionNumber))
      );
      
      const scheduleSession = sessionDay?.sessions.find(s => 
        s.number === Number(session.sessionNumber)
      );

      const platform = scheduleSession?.platforms.find(p => 
        p.platform === session.platform
      );

      // Use platform-specific time if available
      const startTime = platform?.platformStartTime || session.startTime;
      const weighInTime = calculateWeighInTime(startTime);

      const startDate = parseTimeString(startTime, sessionDay?.fullDate || session.date);
      const endDate = new Date(startDate.getTime() + (2 * 60 * 60 * 1000));

      await Calendar.createEventAsync(calendarId, {
        title: `Session ${session.sessionNumber} - Platform ${session.platform}`,
        location: getFullLocation(),
        notes: `Weight Class: ${session.weightClass}\nWeigh-in Time: ${weighInTime}`,
        startDate: startDate,
        endDate: endDate,
        timeZone: 'America/New_York',
        alarms: [{
          relativeOffset: -60,
        }],
      });
    }
  } catch (error) {
    throw error;
  }
}

// Update the helper function to ensure it always returns a string
const getChevronIcon = (direction: 'down' | 'right'): string => {
  return Platform.select({
    ios: `chevron.${direction}`,
    android: direction === 'right' ? 'chevron-forward' : 'chevron-down'
  }) || `chevron.${direction}`; // Fallback to iOS style if platform select fails
};

// Add special value for starred clubs filter
const STARRED_CLUBS_FILTER = 'Favorites';

// Add the helper function
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

export default function StartListScreen() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [weightClassFilter, setWeightClassFilter] = useState('');
  const [clubFilter, setClubFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const { currentTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { saveSessionsFromAthletes } = useSavedSessions();
  
  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
  };

  // Extract unique weight classes
  const weightClassOptions = Array.from(
    new Set(liftingResults.map(athlete => athlete.weightClass))
  ).sort(sortWeightClasses);

  // Add club options extraction (near weightClassOptions)
  const clubOptions = Array.from(
    new Set(liftingResults.map(athlete => athlete.club))
  ).sort();

  // Add new state for starred clubs
  const [starredClubs, setStarredClubs] = useState<string[]>([]);

  // Add useEffect to load starred clubs on mount
  useEffect(() => {
    const loadStarredClubs = async () => {
      try {
        const stored = await AsyncStorage.getItem('starredClubs');
        if (stored) {
          setStarredClubs(JSON.parse(stored));
        }
      } catch (error) {
        console.error('Error loading starred clubs:', error);
      }
    };
    loadStarredClubs();
  }, []);

  // Add function to toggle starred status
  const toggleStarredClub = async (club: string) => {
    try {
      const newStarredClubs = starredClubs.includes(club)
        ? starredClubs.filter(c => c !== club)
        : [...starredClubs, club];
      
      setStarredClubs(newStarredClubs);
      await AsyncStorage.setItem('starredClubs', JSON.stringify(newStarredClubs));
    } catch (error) {
      console.error('Error saving starred clubs:', error);
    }
  };

  // Update the sort function for clubs
  const sortedClubOptions = useMemo(() => {
    return clubOptions.sort((a, b) => {
      const aIsStarred = starredClubs.includes(a);
      const bIsStarred = starredClubs.includes(b);
      
      if (aIsStarred && !bIsStarred) return -1;
      if (!aIsStarred && bIsStarred) return 1;
      
      return a.localeCompare(b);
    });
  }, [clubOptions, starredClubs]);

  const handlePress = (athleteName: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedId(expandedId === athleteName ? null : athleteName);
  };

  // Add new state for age group filter
  const [expandedSection, setExpandedSection] = useState<'ageGroup' | 'weightClass' | 'club' | null>(null);

  // Add new state for temporary filters
  const [tempAgeGroupFilter, setTempAgeGroupFilter] = useState('');
  const [tempWeightClassFilter, setTempWeightClassFilter] = useState('');
  const [tempClubFilter, setTempClubFilter] = useState('');

  // Update getFilterDisplayText to handle age group
  const getFilterDisplayText = () => {
    const filters = [];
    if (weightClassFilter) filters.push(weightClassFilter);
    if (clubFilter) filters.push(clubFilter === STARRED_CLUBS_FILTER ? 'Starred Clubs' : clubFilter);
    if (tempAgeGroupFilter) filters.push(tempAgeGroupFilter);
    
    return filters.length > 0 ? filters.join(' • ') : 'Filter';
  };

  // Update the filtered athletes logic
  const filteredAthletes = liftingResults
    .filter(athlete => {
      const matchesWeightClass = weightClassFilter ? athlete.weightClass === weightClassFilter : true;
      const matchesClub = clubFilter 
        ? clubFilter === STARRED_CLUBS_FILTER 
          ? starredClubs.includes(athlete.club)
          : athlete.club === clubFilter
        : true;
      const matchesSearch = searchQuery 
        ? athlete.name.toLowerCase().includes(searchQuery.toLowerCase())
        : true;
      return matchesWeightClass && matchesClub && matchesSearch;
    })
    .sort(sortAthletes);

  const windowHeight = Dimensions.get('window').height;
  const maxOptionsHeight = windowHeight * 0.4; // 40% of screen height

  const handleSaveAll = async () => {
    Alert.alert(
      'Save Sessions',
      `Save sessions from ${filteredAthletes.length} athlete${filteredAthletes.length === 1 ? '' : 's'} to your saved list?`,
      [
        {
          text: 'Cancel',
          style: 'cancel'
        },
        {
          text: 'Save',
          onPress: async () => {
            try {
              const success = await saveSessionsFromAthletes(filteredAthletes);
              if (success) {
                Alert.alert(
                  'Success', 
                  'Sessions have been saved to your list.',
                  [
                    {
                      text: 'View Saved',
                      onPress: () => router.push('/saved'),
                    },
                    {
                      text: 'OK',
                    }
                  ]
                );
              } else {
                Alert.alert('Error', 'Failed to save sessions.');
              }
            } catch (error) {
              Alert.alert('Error', 'Failed to save sessions.');
              console.error(error);
            }
          }
        }
      ]
    );
  };

  const handleSaveToCalendar = async () => {
    // Get unique sessions from filtered athletes
    const sessionsToAdd = filteredAthletes
      .filter(athlete => athlete.session)
      .map(athlete => ({
        date: schedule.find(day => 
          day.sessions.some(s => s.number === athlete.session?.number)
        )?.fullDate || '',
        startTime: getSessionDetails(athlete.session?.number || 0)?.startTime || '',
        weighInTime: getSessionDetails(athlete.session?.number || 0)?.weighInTime || '',
        sessionNumber: athlete.session?.number.toString() || '',
        platform: athlete.session?.platform || '',
        weightClass: athlete.weightClass
      }));

    if (sessionsToAdd.length === 0) {
      Alert.alert('No Sessions', 'There are no sessions to add to calendar.');
      return;
    }

    Alert.alert(
      'Add to Calendar',
      `Add ${sessionsToAdd.length} session${sessionsToAdd.length === 1 ? '' : 's'} to your calendar?`,
      [
        {
          text: 'Cancel',
          style: 'cancel'
        },
        {
          text: 'Add',
          onPress: async () => {
            try {
              const hasPermission = await requestCalendarPermissions();
              if (!hasPermission) {
                Alert.alert('Permission Required', 'Calendar permission is required to add sessions.');
                return;
              }
              await createCalendarEvents(sessionsToAdd);
              Alert.alert('Success', 'Sessions have been added to your calendar.');
            } catch (error) {
              Alert.alert('Error', error instanceof Error ? error.message : 'Failed to add sessions to calendar.');
              console.error(error);
            }
          }
        }
      ]
    );
  };

  // Add new state for age group filter
  const [ageGroupFilter, setAgeGroupFilter] = useState('');

  // Define age group options
  const ageGroupOptions = ['U13', 'U15', 'U17', 'U23', 'U25', 'Senior', 'Masters 35', 'Masters 40', 'Masters 45', 'Masters 50', 'Masters 55', 'Masters 60', 'Masters 65', 'Masters 70', 'Masters 75', 'Masters 80', 'Masters 85', 'Masters 90'];

  // Update modal open handler
  const handleOpenModal = () => {
    setTempWeightClassFilter(weightClassFilter);
    setTempClubFilter(clubFilter);
    setTempAgeGroupFilter(ageGroupFilter);
    setShowFilterModal(true);
  };

  // Update apply handler
  const handleApplyFilters = () => {
    setWeightClassFilter(tempWeightClassFilter);
    setClubFilter(tempClubFilter);
    setAgeGroupFilter(tempAgeGroupFilter);
    setShowFilterModal(false);
    setExpandedSection(null);
  };

  // Add new state for save modal
  const [showSaveModal, setShowSaveModal] = useState(false);

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.filterContainer, { 
        backgroundColor: colors.background,
        borderBottomColor: currentTheme === 'dark' ? '#2C2C2E' : '#C6C6C8',
        borderBottomWidth: 1,
      }]}>
        <View style={styles.searchContainer}>
          <View style={[
            styles.searchBar,
            { 
              backgroundColor: colors.card,
              borderColor: colors.border
            }
          ]}>
            <IconSymbol 
              name={Platform.select({
                ios: "magnifyingglass",
                android: "search"
              }) || "magnifyingglass"}
              size={16} 
              color={colors.secondaryText}
            />
            <TextInput
              style={[
                styles.searchInput,
                { color: colors.text }
              ]}
              placeholder="Search athletes..."
              placeholderTextColor={colors.secondaryText}
              value={searchQuery}
              onChangeText={setSearchQuery}
              clearButtonMode="while-editing"
            />
          </View>
        </View>
        <View style={styles.buttonRow}>
          <Pressable
            style={({ pressed }) => [
              styles.button,
              { 
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={handleOpenModal}
          >
            <ThemedText style={[styles.buttonText, { color: colors.secondaryText }]}>
              {getFilterDisplayText()}
            </ThemedText>
            <IconSymbol 
              name={getChevronIcon('down')} 
              size={12} 
              color={colors.secondaryText} 
            />
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.button,
              { 
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => setShowSaveModal(true)}
          >
            <IconSymbol 
              name={Platform.select({
                ios: "square.and.arrow.down",
                android: "download"
              })} 
              size={16} 
              color={colors.secondaryText} 
            />
            <ThemedText style={[styles.buttonText, { color: colors.secondaryText }]}>
              Save
            </ThemedText>
          </Pressable>
        </View>
      </View>

      <FlatList
        data={filteredAthletes}
        keyExtractor={item => item.name}
        renderItem={({ item }) => (
          <AthleteItem
            athlete={item}
            isExpanded={expandedId === item.name}
            onPress={() => handlePress(item.name)}
            router={router}
          />
        )}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: 80 + insets.bottom }
        ]}
        showsVerticalScrollIndicator={false}
      />

      <Modal
        visible={showFilterModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          setExpandedSection(null);
          setShowFilterModal(false);
        }}
      >
        <Pressable 
          style={[
            styles.modalOverlay,
            { backgroundColor: currentTheme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.4)' }
          ]}
          onPress={() => {
            setExpandedSection(null);
            setShowFilterModal(false);
          }}
        >
          <View style={[
            styles.modalContent,
            { 
              backgroundColor: colors.card,
              maxHeight: windowHeight * 0.8
            }
          ]}>
            <View style={styles.modalScrollContent}>
              <ScrollView bounces={false}>
                {/* Age Group Filter */}
                <View style={[styles.filterSection, { borderBottomColor: colors.border }]}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.filterSectionButton,
                      { borderBottomColor: colors.border },
                      pressed && { opacity: 0.8 }
                    ]}
                    onPress={() => setExpandedSection(
                      expandedSection === 'ageGroup' ? null : 'ageGroup'
                    )}
                  >
                    <View style={styles.filterSectionButtonContent}>
                      <View>
                        <ThemedText style={[styles.filterSectionLabel, { color: colors.secondaryText }]}>
                          Age Group
                        </ThemedText>
                        <ThemedText style={[styles.filterSectionValue, { color: colors.text }]}>
                          {tempAgeGroupFilter || 'All Age Groups'}
                        </ThemedText>
                      </View>
                      <IconSymbol 
                        name={getChevronIcon(expandedSection === 'ageGroup' ? 'down' : 'right')} 
                        size={16} 
                        color={colors.secondaryText}
                      />
                    </View>
                  </Pressable>
                  
                  {expandedSection === 'ageGroup' && (
                    <ScrollView 
                      style={[
                        styles.filterOptions,
                        { maxHeight: maxOptionsHeight }
                      ]}
                      bounces={false}
                    >
                      <Pressable
                        style={({ pressed }) => [
                          styles.filterOption,
                          { borderBottomColor: colors.border },
                          tempAgeGroupFilter === '' && { backgroundColor: colors.pressed },
                          pressed && { opacity: 0.8 }
                        ]}
                        onPress={() => {
                          setTempAgeGroupFilter('');
                          setExpandedSection(null);
                        }}
                      >
                        <ThemedText style={[
                          styles.filterOptionText,
                          { color: colors.text },
                          tempAgeGroupFilter === '' && { color: '#007AFF' }
                        ]}>
                          All Age Groups
                        </ThemedText>
                        {tempAgeGroupFilter === '' && (
                          <IconSymbol name="checkmark" size={16} color="#007AFF" />
                        )}
                      </Pressable>
                      {ageGroupOptions.map((ageGroup) => (
                        <Pressable
                          key={ageGroup}
                          style={({ pressed }) => [
                            styles.filterOption,
                            { borderBottomColor: colors.border },
                            tempAgeGroupFilter === ageGroup && { backgroundColor: colors.pressed },
                            pressed && { opacity: 0.8 }
                          ]}
                          onPress={() => {
                            setTempAgeGroupFilter(ageGroup);
                            setExpandedSection(null);
                          }}
                        >
                          <ThemedText style={[
                            styles.filterOptionText,
                            { color: colors.text },
                            tempAgeGroupFilter === ageGroup && { color: '#007AFF' }
                          ]}>
                            {ageGroup}
                          </ThemedText>
                          {tempAgeGroupFilter === ageGroup && (
                            <IconSymbol name="checkmark" size={16} color="#007AFF" />
                          )}
                        </Pressable>
                      ))}
                    </ScrollView>
                  )}
                </View>

                {/* Weight Class Filter */}
                <View style={[styles.filterSection, { borderBottomColor: colors.border }]}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.filterSectionButton,
                      { borderBottomColor: colors.border },
                      pressed && { opacity: 0.8 }
                    ]}
                    onPress={() => setExpandedSection(
                      expandedSection === 'weightClass' ? null : 'weightClass'
                    )}
                  >
                    <View style={styles.filterSectionButtonContent}>
                      <View>
                        <ThemedText style={[styles.filterSectionLabel, { color: colors.secondaryText }]}>
                          Weight Class
                        </ThemedText>
                        <ThemedText style={[styles.filterSectionValue, { color: colors.text }]}>
                          {tempWeightClassFilter || 'All Classes'}
                        </ThemedText>
                      </View>
                      <IconSymbol 
                        name={getChevronIcon(expandedSection === 'weightClass' ? 'down' : 'right')} 
                        size={16} 
                        color={colors.secondaryText}
                      />
                    </View>
                  </Pressable>
                  
                  {expandedSection === 'weightClass' && (
                    <ScrollView 
                      style={[
                        styles.filterOptions,
                        { maxHeight: maxOptionsHeight }
                      ]}
                      bounces={false}
                    >
                      <Pressable
                        style={({ pressed }) => [
                          styles.filterOption,
                          { borderBottomColor: colors.border },
                          tempWeightClassFilter === '' && { backgroundColor: colors.pressed },
                          pressed && { opacity: 0.8 }
                        ]}
                        onPress={() => {
                          setTempWeightClassFilter('');
                          setExpandedSection(null);
                        }}
                      >
                        <ThemedText style={[
                          styles.filterOptionText,
                          { color: colors.text },
                          tempWeightClassFilter === '' && { color: '#007AFF' }
                        ]}>
                          All Classes
                        </ThemedText>
                        {tempWeightClassFilter === '' && (
                          <IconSymbol name="checkmark" size={16} color="#007AFF" />
                        )}
                      </Pressable>
                      {weightClassOptions.map((weightClass) => (
                        <Pressable
                          key={weightClass}
                          style={({ pressed }) => [
                            styles.filterOption,
                            { borderBottomColor: colors.border },
                            tempWeightClassFilter === weightClass && { backgroundColor: colors.pressed },
                            pressed && { opacity: 0.8 }
                          ]}
                          onPress={() => {
                            setTempWeightClassFilter(weightClass);
                            setExpandedSection(null);
                          }}
                        >
                          <ThemedText style={[
                            styles.filterOptionText,
                            { color: colors.text },
                            tempWeightClassFilter === weightClass && { color: '#007AFF' }
                          ]}>
                            {weightClass}
                          </ThemedText>
                          {tempWeightClassFilter === weightClass && (
                            <IconSymbol name="checkmark" size={16} color="#007AFF" />
                          )}
                        </Pressable>
                      ))}
                    </ScrollView>
                  )}
                </View>

                {/* Club Filter */}
                <View style={styles.filterSection}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.filterSectionButton,
                      pressed && { opacity: 0.8 }
                    ]}
                    onPress={() => setExpandedSection(
                      expandedSection === 'club' ? null : 'club'
                    )}
                  >
                    <View style={styles.filterSectionButtonContent}>
                      <View>
                        <ThemedText style={[styles.filterSectionLabel, { color: colors.secondaryText }]}>
                          Club
                        </ThemedText>
                        <ThemedText style={[styles.filterSectionValue, { color: colors.text }]}>
                          {tempClubFilter || 'All Clubs'}
                        </ThemedText>
                      </View>
                      <IconSymbol 
                        name={getChevronIcon(expandedSection === 'club' ? 'down' : 'right')} 
                        size={16} 
                        color={colors.secondaryText}
                      />
                    </View>
                  </Pressable>

                  {expandedSection === 'club' && (
                    <ScrollView 
                      style={[
                        styles.filterOptions,
                        { maxHeight: maxOptionsHeight }
                      ]}
                      bounces={false}
                    >
                      {/* All Clubs option */}
                      <Pressable
                        style={({ pressed }) => [
                          styles.filterOption,
                          { borderBottomColor: colors.border },
                          tempClubFilter === '' && { backgroundColor: colors.pressed },
                          pressed && { opacity: 0.8 }
                        ]}
                        onPress={() => {
                          setTempClubFilter('');
                          setExpandedSection(null);
                        }}
                      >
                        <ThemedText style={[
                          styles.filterOptionText,
                          { color: colors.text },
                          tempClubFilter === '' && { color: '#007AFF' }
                        ]}>
                          All Clubs
                        </ThemedText>
                        {tempClubFilter === '' && (
                          <IconSymbol name="checkmark" size={16} color="#007AFF" />
                        )}
                      </Pressable>

                      {/* All Starred Clubs option */}
                      {starredClubs.length > 0 && (
                        <Pressable
                          style={({ pressed }) => [
                            styles.filterOption,
                            { borderBottomColor: colors.border },
                            tempClubFilter === STARRED_CLUBS_FILTER && { backgroundColor: colors.pressed },
                            pressed && { opacity: 0.8 }
                          ]}
                          onPress={() => {
                            setTempClubFilter(STARRED_CLUBS_FILTER);
                            setExpandedSection(null);
                          }}
                        >
                          <View style={styles.filterOptionContent}>
                            <ThemedText style={[
                              styles.filterOptionText,
                              { color: colors.text },
                              tempClubFilter === STARRED_CLUBS_FILTER && { color: '#007AFF' }
                            ]}>
                              Favorites
                            </ThemedText>
                            <IconSymbol 
                              name="star.fill"
                              size={22}
                              color="#FFB340"
                            />
                          </View>
                          {tempClubFilter === STARRED_CLUBS_FILTER && (
                            <IconSymbol name="checkmark" size={16} color="#007AFF" />
                          )}
                        </Pressable>
                      )}

                      {/* Individual club options */}
                      {sortedClubOptions.map((club) => (
                        <Pressable
                          key={club}
                          style={({ pressed }) => [
                            styles.filterOption,
                            { borderBottomColor: colors.border },
                            tempClubFilter === club && { backgroundColor: colors.pressed },
                            pressed && { opacity: 0.8 }
                          ]}
                          onPress={() => {
                            setTempClubFilter(club);
                            setExpandedSection(null);
                          }}
                        >
                          <ThemedText 
                            style={[
                              styles.filterOptionText,
                              { color: colors.text },
                              tempClubFilter === club && { color: '#007AFF' }
                            ]}
                            numberOfLines={2}
                          >
                            {club}
                          </ThemedText>
                          <View style={styles.filterOptionRight}>
                            {tempClubFilter === club && (
                              <IconSymbol name="checkmark" size={16} color="#007AFF" />
                            )}
                            <Pressable
                              onPress={(e) => {
                                e.stopPropagation();
                                toggleStarredClub(club);
                              }}
                              style={styles.starButton}
                            >
                              <IconSymbol
                                name={starredClubs.includes(club) ? 'star.fill' : 'star'}
                                size={22}
                                color={starredClubs.includes(club) ? '#FFB340' : colors.secondaryText}
                              />
                            </Pressable>
                          </View>
                        </Pressable>
                      ))}
                    </ScrollView>
                  )}
                </View>
              </ScrollView>
            </View>

            <View style={[styles.modalFooter, { borderTopColor: colors.border }]}>
              <ThemedText style={[styles.resultCount, { color: colors.secondaryText }]}>
                {filteredAthletes.length} athletes
              </ThemedText>
              <Pressable
                style={({ pressed }) => [
                  styles.applyButton,
                  pressed && { opacity: 0.8 }
                ]}
                onPress={handleApplyFilters}
              >
                <ThemedText style={styles.applyButtonText}>
                  Apply
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={showSaveModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowSaveModal(false)}
      >
        <Pressable 
          style={[
            styles.modalOverlay,
            { backgroundColor: currentTheme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.4)' }
          ]}
          onPress={() => setShowSaveModal(false)}
        >
          <View style={[
            styles.modalContent,
            { backgroundColor: colors.card }
          ]}>
            <View style={[styles.saveModalHeader, { borderBottomColor: colors.border }]}>
              <ThemedText style={[styles.saveModalTitle, { color: colors.text }]}>
                Save {filteredAthletes.length} Athletes
              </ThemedText>
              <Pressable
                style={({ pressed }) => [
                  styles.closeButton,
                  pressed && { opacity: 0.8 }
                ]}
                onPress={() => setShowSaveModal(false)}
              >
                <IconSymbol 
                  name={Platform.select({
                    ios: "xmark",
                    android: "close"
                  })}
                  size={20} 
                  color={colors.secondaryText} 
                />
              </Pressable>
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.saveOption,
                { borderBottomColor: colors.border },
                pressed && { backgroundColor: colors.pressed }
              ]}
              onPress={() => {
                setShowSaveModal(false);
                handleSaveAll();
              }}
            >
              <View style={styles.saveOptionContent}>
                <IconSymbol name="bookmark" size={22} color={colors.text} />
                <View style={styles.saveOptionText}>
                  <ThemedText style={[styles.saveOptionTitle, { color: colors.text }]}>
                    Add to Saved
                  </ThemedText>
                  <ThemedText style={[styles.saveOptionSubtitle, { color: colors.secondaryText }]}>
                    Save sessions to your list
                  </ThemedText>
                </View>
              </View>
              <IconSymbol 
                name={getChevronIcon('right')} 
                size={16} 
                color={colors.secondaryText} 
              />
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.saveOption,
                pressed && { backgroundColor: colors.pressed }
              ]}
              onPress={() => {
                setShowSaveModal(false);
                handleSaveToCalendar();
              }}
            >
              <View style={styles.saveOptionContent}>
                <IconSymbol name="calendar" size={22} color={colors.text} />
                <View style={styles.saveOptionText}>
                  <ThemedText style={[styles.saveOptionTitle, { color: colors.text }]}>
                    Add to Calendar
                  </ThemedText>
                  <ThemedText style={[styles.saveOptionSubtitle, { color: colors.secondaryText }]}>
                    Save sessions to your calendar
                  </ThemedText>
                </View>
              </View>
              <IconSymbol 
                name={getChevronIcon('right')} 
                size={16} 
                color={colors.secondaryText} 
              />
            </Pressable>
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
  listContent: {
    padding: 16,
    gap: 12,
  },
  athleteCard: {
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  athleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  athleteName: {
    fontSize: 17,
    fontWeight: '400',
  },
  detailsContainer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  wrappingDetailRow: {
    alignItems: 'flex-start',
  },
  detailLabel: {
    fontSize: 15,
    minWidth: 95,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '500',
  },
  wrappingDetailValue: {
    flex: 1,
    paddingLeft: 16,
  },
  wrappingText: {
    textAlign: 'right',
    flexWrap: 'wrap',
  },
  filterContainer: {
    padding: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 6,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
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
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
    marginHorizontal: 16,
    maxHeight: '80%', // Fallback if windowHeight not available
  },
  filterSection: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterSectionButton: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterSectionButtonContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  filterSectionLabel: {
    fontSize: 13,
    marginBottom: 4,
  },
  filterSectionValue: {
    fontSize: 17,
    fontWeight: '400',
  },
  filterOptions: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  filterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterOptionText: {
    fontSize: 17,
    flex: 1,
    marginRight: 16,
  },
  searchContainer: {
    marginBottom: 6,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    elevation: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    padding: 0, // Remove default padding on iOS
    height: 24, // Match the height of other buttons
  },
  modalScrollContent: {
    flexGrow: 1,
  },
  modalFooter: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  resultCount: {
    fontSize: 15,
  },
  applyButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
  },
  applyButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  saveModalHeader: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    position: 'relative',
  },
  closeButton: {
    position: 'absolute',
    right: 16,
    top: 16,
    padding: 4,
    zIndex: 1,
  },
  saveModalTitle: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  saveOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  saveOptionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  saveOptionText: {
    gap: 4,
  },
  saveOptionTitle: {
    fontSize: 17,
    fontWeight: '400',
  },
  saveOptionSubtitle: {
    fontSize: 13,
  },
  sessionLink: {
    borderRadius: 8,
    marginHorizontal: -8,
    paddingHorizontal: 8,
  },
  sessionValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  filterOptionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexShrink: 0,
  },
  starButton: {
    padding: 6,
    marginRight: -6,
  },
  filterOptionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  starredClubsIcon: {
    marginTop: 1,
  },
  statsContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  statsTitle: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
    textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 13,
    marginBottom: 2,
    textAlign: 'center',
  },
  statValue: {
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
  },
  meetResultsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  meetResultsText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#007AFF',
  },
}); 