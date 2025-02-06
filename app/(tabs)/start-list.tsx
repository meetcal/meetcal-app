import { useState } from 'react';
import { StyleSheet, View, FlatList, Pressable, LayoutAnimation, Modal, ScrollView, Dimensions, Alert, TextInput } from 'react-native';
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

function getSessionDetails(sessionNumber: number) {
  for (const day of schedule) {
    const session = day.sessions.find(s => s.number === sessionNumber);
    if (session) {
      return {
        date: day.fullDate,
        startTime: session.startTime,
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
}

function AthleteItem({ athlete, isExpanded, onPress }: AthleteItemProps) {
  const { currentTheme } = useTheme();
  
  const colors = {
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
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
          name={isExpanded ? "chevron.down" : "chevron.right"} 
          size={20} 
          color={colors.secondaryText}
        />
      </Pressable>
      
      {isExpanded && (
        <View style={[styles.detailsContainer, { borderTopColor: colors.border }]}>
          {athlete.session && (
            <>
              <View style={styles.detailRow}>
                <ThemedText style={[styles.detailLabel, { color: colors.secondaryText }]}>
                  Session:
                </ThemedText>
                <ThemedText style={styles.detailValue}>
                  Session {athlete.session.number} • {athlete.session.platform} Platform
                </ThemedText>
              </View>
              {getSessionDetails(athlete.session.number) && (
                <View style={styles.detailRow}>
                  <ThemedText style={[styles.detailLabel, { color: colors.secondaryText }]}>
                    Date & Time:
                  </ThemedText>
                  <ThemedText style={styles.detailValue}>
                    {getSessionDetails(athlete.session.number)?.displayDate} • {getSessionDetails(athlete.session.number)?.startTime}
                  </ThemedText>
                </View>
              )}
            </>
          )}
          <View style={styles.detailRow}>
            <ThemedText style={[styles.detailLabel, { color: colors.secondaryText }]}>
              Club:
            </ThemedText>
            <ThemedText style={styles.detailValue}>{athlete.club}</ThemedText>
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

async function createCalendarEvents(sessions: Array<{
  date: string;
  startTime: string;
  weighInTime: string;
  sessionNumber: number;
  platform: string;
  weightClass: string;
}>) {
  const calendar = await Calendar.getDefaultCalendarAsync();
  
  for (const session of sessions) {
    const [year, month, day] = session.date.split('-').map(Number);
    
    let [timeStr, meridiem] = session.startTime.split(' ');
    let [hours, minutes] = timeStr.split(':').map(Number);
    
    if (meridiem === 'PM' && hours !== 12) {
      hours += 12;
    } else if (meridiem === 'AM' && hours === 12) {
      hours = 0;
    }
    
    const startDate = new Date(year, month - 1, day, hours, minutes);
    const endDate = new Date(startDate.getTime() + (2 * 60 * 60 * 1000));

    await Calendar.createEventAsync(calendar.id, {
      title: `Session ${session.sessionNumber} - Platform ${session.platform}`,
      location: getFullLocation(), // Need to import this
      notes: `Weight Class: ${session.weightClass}\nWeigh-in Time: ${session.weighInTime}`, // Need weightClass and weighInTime
      startDate,
      endDate,
      timeZone: 'America/New_York', // Match the exact timezone
      alarms: [{
        relativeOffset: -60,
      }],
    });
  }
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

  const handlePress = (athleteName: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedId(expandedId === athleteName ? null : athleteName);
  };

  const getFilterDisplayText = () => {
    if (weightClassFilter && clubFilter) {
      return `${weightClassFilter} • ${clubFilter}`;
    } else if (weightClassFilter) {
      return weightClassFilter;
    } else if (clubFilter) {
      return clubFilter;
    }
    return 'Filter';
  };

  const filteredAthletes = liftingResults
    .filter(athlete => {
      const matchesWeightClass = weightClassFilter ? athlete.weightClass === weightClassFilter : true;
      const matchesClub = clubFilter ? athlete.club === clubFilter : true;
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
    const uniqueSessions = filteredAthletes
      .filter(athlete => athlete.session)
      .map(athlete => {
        const sessionDetails = getSessionDetails(athlete.session!.number);
        const session = schedule
          .flatMap(day => day.sessions)
          .find(s => s.number === athlete.session!.number);
          
        return {
          date: sessionDetails?.date || '',
          startTime: sessionDetails?.startTime || '',
          weighInTime: session?.weighInTime || '',
          sessionNumber: athlete.session!.number,
          platform: athlete.session!.platform,
          weightClass: athlete.weightClass
        };
      })
      .filter(session => session.date && session.startTime)
      .filter((session, index, self) => 
        index === self.findIndex(s => 
          s.date === session.date && 
          s.startTime === session.startTime
        )
      );

    if (uniqueSessions.length === 0) {
      Alert.alert('No Sessions', 'There are no sessions to add to calendar.');
      return;
    }

    Alert.alert(
      'Add to Calendar',
      `Add ${uniqueSessions.length} session${uniqueSessions.length === 1 ? '' : 's'} to your calendar?`,
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
              await createCalendarEvents(uniqueSessions);
              Alert.alert('Success', 'Sessions have been added to your calendar.');
            } catch (error) {
              Alert.alert('Error', 'Failed to add sessions to calendar.');
              console.error(error);
            }
          }
        }
      ]
    );
  };

  // Add new state for expanded section
  const [expandedSection, setExpandedSection] = useState<'weightClass' | 'club' | null>(null);

  // Add new state for temporary filters
  const [tempWeightClassFilter, setTempWeightClassFilter] = useState('');
  const [tempClubFilter, setTempClubFilter] = useState('');

  // Add helper function to count filtered results
  const getFilteredCount = (weightClass: string, club: string) => {
    return liftingResults.filter(athlete => {
      const matchesWeightClass = weightClass ? athlete.weightClass === weightClass : true;
      const matchesClub = club ? athlete.club === club : true;
      const matchesSearch = searchQuery 
        ? athlete.name.toLowerCase().includes(searchQuery.toLowerCase())
        : true;
      return matchesWeightClass && matchesClub && matchesSearch;
    }).length;
  };

  // Update modal open handler
  const handleOpenModal = () => {
    setTempWeightClassFilter(weightClassFilter);
    setTempClubFilter(clubFilter);
    setShowFilterModal(true);
  };

  // Add apply handler
  const handleApplyFilters = () => {
    setWeightClassFilter(tempWeightClassFilter);
    setClubFilter(tempClubFilter);
    setShowFilterModal(false);
    setExpandedSection(null);
  };

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
              name="magnifyingglass" 
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
        <View style={styles.filterButtonsRow}>
          <Pressable
            style={({ pressed }) => [
              styles.filterButton,
              { 
                backgroundColor: colors.card,
                borderColor: colors.border,
                flex: 1,
              },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={handleOpenModal}
          >
            <ThemedText style={[styles.filterButtonText, { color: colors.secondaryText }]}>
              {getFilterDisplayText()}
            </ThemedText>
            <IconSymbol name="chevron.down" size={12} color={colors.secondaryText} />
          </Pressable>
        </View>
        
        <View style={styles.actionButtonsRow}>
          <Pressable
            style={({ pressed }) => [
              styles.actionButton,
              { 
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={handleSaveAll}
          >
            <IconSymbol name="bookmark" size={16} color={colors.secondaryText} />
            <ThemedText style={[styles.filterButtonText, { color: colors.secondaryText }]}>
              Save All
            </ThemedText>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.actionButton,
              { 
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={handleSaveToCalendar}
          >
            <IconSymbol name="calendar" size={16} color={colors.secondaryText} />
            <ThemedText style={[styles.filterButtonText, { color: colors.secondaryText }]}>
              Add to Calendar
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
                          {weightClassFilter || 'All Classes'}
                        </ThemedText>
                      </View>
                      <IconSymbol 
                        name={expandedSection === 'weightClass' ? "chevron.up" : "chevron.down"} 
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
                          weightClassFilter === '' && { backgroundColor: colors.pressed },
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
                          weightClassFilter === '' && { color: '#007AFF' }
                        ]}>
                          All Classes
                        </ThemedText>
                        {weightClassFilter === '' && (
                          <IconSymbol name="checkmark" size={16} color="#007AFF" />
                        )}
                      </Pressable>
                      {weightClassOptions.map((weightClass) => (
                        <Pressable
                          key={weightClass}
                          style={({ pressed }) => [
                            styles.filterOption,
                            { borderBottomColor: colors.border },
                            weightClassFilter === weightClass && { backgroundColor: colors.pressed },
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
                            weightClassFilter === weightClass && { color: '#007AFF' }
                          ]}>
                            {weightClass}
                          </ThemedText>
                          {weightClassFilter === weightClass && (
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
                          {clubFilter || 'All Clubs'}
                        </ThemedText>
                      </View>
                      <IconSymbol 
                        name={expandedSection === 'club' ? "chevron.up" : "chevron.down"} 
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
                      <Pressable
                        style={({ pressed }) => [
                          styles.filterOption,
                          { borderBottomColor: colors.border },
                          clubFilter === '' && { backgroundColor: colors.pressed },
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
                          clubFilter === '' && { color: '#007AFF' }
                        ]}>
                          All Clubs
                        </ThemedText>
                        {clubFilter === '' && (
                          <IconSymbol name="checkmark" size={16} color="#007AFF" />
                        )}
                      </Pressable>
                      {clubOptions.map((club) => (
                        <Pressable
                          key={club}
                          style={({ pressed }) => [
                            styles.filterOption,
                            { borderBottomColor: colors.border },
                            clubFilter === club && { backgroundColor: colors.pressed },
                            pressed && { opacity: 0.8 }
                          ]}
                          onPress={() => {
                            setTempClubFilter(club);
                            setExpandedSection(null);
                          }}
                        >
                          <ThemedText style={[
                            styles.filterOptionText,
                            { color: colors.text },
                            clubFilter === club && { color: '#007AFF' }
                          ]}>
                            {club}
                          </ThemedText>
                          {clubFilter === club && (
                            <IconSymbol name="checkmark" size={16} color="#007AFF" />
                          )}
                        </Pressable>
                      ))}
                    </ScrollView>
                  )}
                </View>
              </ScrollView>
            </View>

            <View style={[styles.modalFooter, { borderTopColor: colors.border }]}>
              <ThemedText style={[styles.resultCount, { color: colors.secondaryText }]}>
                {getFilteredCount(tempWeightClassFilter, tempClubFilter)} athletes
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
  detailLabel: {
    fontSize: 15,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '500',
  },
  filterContainer: {
    padding: 16,
  },
  filterButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  filterButton: {
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
    paddingLeft: 32,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterOptionText: {
    fontSize: 17,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 12,
  },
  actionButton: {
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
  searchContainer: {
    marginBottom: 12,
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
}); 