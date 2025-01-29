import { useState } from 'react';
import { StyleSheet, View, FlatList, Pressable, LayoutAnimation, Modal, ScrollView, Dimensions } from 'react-native';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { useTheme } from '@/contexts/ThemeContext';
import { LiftResult, liftingResults } from '@/data/athletes';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { schedule } from '@/data/schedule';

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

  function getSessionDetails(sessionNumber: number) {
    for (const day of schedule) {
      const session = day.sessions.find(s => s.number === sessionNumber);
      if (session) {
        return {
          date: day.date,
          startTime: session.startTime
        };
      }
    }
    return null;
  }

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
                    {getSessionDetails(athlete.session.number)?.date} • {getSessionDetails(athlete.session.number)?.startTime}
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

export default function StartListScreen() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [weightClassFilter, setWeightClassFilter] = useState('');
  const [showClubModal, setShowClubModal] = useState(false);
  const [clubFilter, setClubFilter] = useState('');
  const { currentTheme } = useTheme();
  const insets = useSafeAreaInsets();
  
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

  const handleFilterSelect = (weightClass: string) => {
    setWeightClassFilter(weightClass);
    setShowFilterModal(false);
  };

  const handleClubSelect = (club: string) => {
    setClubFilter(club);
    setShowClubModal(false);
  };

  const filteredAthletes = liftingResults
    .filter(athlete => {
      const matchesWeightClass = weightClassFilter ? athlete.weightClass === weightClassFilter : true;
      const matchesClub = clubFilter ? athlete.club === clubFilter : true;
      return matchesWeightClass && matchesClub;
    })
    .sort(sortAthletes);

  const windowHeight = Dimensions.get('window').height;

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.filterContainer, { 
        backgroundColor: colors.background,
        borderBottomColor: currentTheme === 'dark' ? '#2C2C2E' : '#C6C6C8',
        borderBottomWidth: 1,
      }]}>
        <View style={styles.filterButtonsRow}>
          <Pressable
            style={({ pressed }) => [
              styles.filterButton,
              { 
                backgroundColor: colors.card,
                borderColor: colors.border,
                flex: 1,
                marginRight: 8
              },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => setShowFilterModal(true)}
          >
            <ThemedText style={[styles.filterButtonText, { color: colors.secondaryText }]}>
              {weightClassFilter || 'All Classes'}
            </ThemedText>
            <IconSymbol name="chevron.down" size={12} color={colors.secondaryText} />
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.filterButton,
              { 
                backgroundColor: colors.card,
                borderColor: colors.border,
                flex: 1,
                marginLeft: 8
              },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => setShowClubModal(true)}
          >
            <ThemedText style={[styles.filterButtonText, { color: colors.secondaryText }]}>
              {clubFilter || 'All Clubs'}
            </ThemedText>
            <IconSymbol name="chevron.down" size={12} color={colors.secondaryText} />
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
        onRequestClose={() => setShowFilterModal(false)}
      >
        <Pressable 
          style={[
            styles.modalOverlay,
            { backgroundColor: currentTheme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.4)' }
          ]}
          onPress={() => setShowFilterModal(false)}
        >
          <Pressable style={[
            styles.modalContent,
            { 
              maxHeight: windowHeight * 0.7,
              backgroundColor: colors.card
            }
          ]}>
            <ScrollView bounces={false}>
              <Pressable
                key="all"
                style={({ pressed }) => [
                  styles.modalOption,
                  { borderBottomColor: colors.border },
                  weightClassFilter === '' && { backgroundColor: colors.pressed },
                  pressed && { opacity: 0.8 }
                ]}
                onPress={() => handleFilterSelect('')}
              >
                <ThemedText style={[
                  styles.modalOptionText,
                  weightClassFilter === '' && { color: '#007AFF' }
                ]}>
                  All Weight Classes
                </ThemedText>
                {weightClassFilter === '' && (
                  <IconSymbol name="checkmark" size={16} color="#007AFF" />
                )}
              </Pressable>
              {weightClassOptions.map((weightClass) => (
                <Pressable
                  key={weightClass}
                  style={({ pressed }) => [
                    styles.modalOption,
                    { borderBottomColor: colors.border },
                    weightClassFilter === weightClass && { backgroundColor: colors.pressed },
                    pressed && { opacity: 0.8 }
                  ]}
                  onPress={() => handleFilterSelect(weightClass)}
                >
                  <ThemedText style={[
                    styles.modalOptionText,
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
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={showClubModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowClubModal(false)}
      >
        <Pressable 
          style={[
            styles.modalOverlay,
            { backgroundColor: currentTheme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.4)' }
          ]}
          onPress={() => setShowClubModal(false)}
        >
          <Pressable style={[
            styles.modalContent,
            { 
              maxHeight: windowHeight * 0.7,
              backgroundColor: colors.card
            }
          ]}>
            <ScrollView bounces={false}>
              <Pressable
                key="all-clubs"
                style={({ pressed }) => [
                  styles.modalOption,
                  { borderBottomColor: colors.border },
                  clubFilter === '' && { backgroundColor: colors.pressed },
                  pressed && { opacity: 0.8 }
                ]}
                onPress={() => {
                  setClubFilter('');
                  setShowClubModal(false);
                }}
              >
                <ThemedText style={[
                  styles.modalOptionText,
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
                    styles.modalOption,
                    { borderBottomColor: colors.border },
                    clubFilter === club && { backgroundColor: colors.pressed },
                    pressed && { opacity: 0.8 }
                  ]}
                  onPress={() => {
                    setClubFilter(club);
                    setShowClubModal(false);
                  }}
                >
                  <ThemedText style={[
                    styles.modalOptionText,
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
          </Pressable>
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
  },
  modalOptionText: {
    fontSize: 17,
  },
}); 