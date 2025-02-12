import { StyleSheet, View, ScrollView, Pressable, Modal, Dimensions } from 'react-native';
import { Stack } from 'expo-router';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { useTheme } from '@/contexts/ThemeContext';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { useState } from 'react';
import { qualifyingTotals } from '@/data/qualifying';

type Gender = 'Men' | 'Women';
type Event = 'Nationals' | 'Virus Series' | 'Virus Finals';
type AgeGroup = 'Senior' | 'U25' | 'U23' | 'University' | 'Junior' | 'U17' | 'U15' | 'U13';

interface Filters {
  event: Event;
  gender: Gender;
  ageGroup: AgeGroup;
}

const windowHeight = Dimensions.get('window').height;
const maxOptionsHeight = windowHeight * 0.4; // 40% of screen height

export default function QualifyingTotalsScreen() {
  const { currentTheme } = useTheme();
  const [filters, setFilters] = useState<Filters>({
    event: 'Nationals',
    gender: 'Men',
    ageGroup: 'Senior'
  });
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [expandedSection, setExpandedSection] = useState<'event' | 'gender' | 'ageGroup' | null>(null);
  const [tempFilters, setTempFilters] = useState<Filters>(filters);

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
  };

  const getFilterDisplayText = () => {
    const parts = [];
    parts.push(filters.event);
    parts.push(filters.gender);
    parts.push(filters.ageGroup[0].toUpperCase() + filters.ageGroup.slice(1));
    return parts.join(' • ');
  };

  const handleApplyFilters = () => {
    setFilters(tempFilters);
    setShowFilterModal(false);
    setExpandedSection(null);
  };

  const getCurrentTotals = () => {
    const eventData = qualifyingTotals[filters.event];
    if (!eventData) return [];
    
    const genderData = eventData[filters.gender];
    if (!genderData) return [];

    const ageGroupData = genderData.ageCategories.find(
      ag => ag.name === filters.ageGroup
    );
    if (!ageGroupData) return [];

    return ageGroupData.weightClasses;
  };

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ 
        title: "Qualifying Totals",
        headerBackTitle: "Back",
        headerShown: true,
        gestureEnabled: true,
        gestureDirection: 'horizontal',
        animation: 'slide_from_right',
        headerStyle: {
          backgroundColor: colors.background,
        },
        headerShadowVisible: false,
      }} />

      <View style={[styles.filterContainer, { 
        backgroundColor: colors.background,
        borderBottomColor: currentTheme === 'dark' ? '#2C2C2E' : '#C6C6C8',
        borderBottomWidth: 1,
      }]}>
        <View style={styles.filterButtons}>
          <Pressable
            style={({ pressed }) => [
              styles.filterButton,
              { 
                backgroundColor: colors.card,
                borderColor: colors.border 
              },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => {
              setTempFilters(filters);
              setShowFilterModal(true);
            }}
          >
            <ThemedText style={[styles.filterButtonText, { color: colors.secondaryText }]}>
              {getFilterDisplayText()}
            </ThemedText>
            <IconSymbol name="chevron.down" size={12} color={colors.secondaryText} />
          </Pressable>
        </View>
      </View>

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={[styles.headerRow, { borderBottomColor: colors.border }]}>
            <ThemedText style={[styles.headerCell, { flex: 2 }]}>Weight Class</ThemedText>
            <ThemedText style={styles.headerCell}>Total</ThemedText>
          </View>

          {getCurrentTotals().map((record: WeightClass, index: number, array: WeightClass[]) => (
            <View 
              key={record.bodyweightDivision}
              style={[
                styles.row,
                index < array.length - 1 && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: colors.border
                }
              ]}
            >
              <ThemedText style={[styles.cell, { flex: 2 }]}>{record.bodyweightDivision}</ThemedText>
              <ThemedText style={styles.cell}>{record.qt}kg</ThemedText>
            </View>
          ))}
        </View>
      </ScrollView>

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
                {/* Event Filter */}
                <View style={[styles.filterSection, { borderBottomColor: colors.border }]}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.filterSectionButton,
                      { borderBottomColor: colors.border },
                      pressed && { opacity: 0.8 }
                    ]}
                    onPress={() => setExpandedSection(
                      expandedSection === 'event' ? null : 'event'
                    )}
                  >
                    <View style={styles.filterSectionButtonContent}>
                      <View>
                        <ThemedText style={[styles.filterSectionLabel, { color: colors.secondaryText }]}>
                          Event
                        </ThemedText>
                        <ThemedText style={[styles.filterSectionValue, { color: colors.text }]}>
                          {tempFilters.event}
                        </ThemedText>
                      </View>
                      <IconSymbol 
                        name={expandedSection === 'event' ? 'chevron.down' : 'chevron.right'} 
                        size={16} 
                        color={colors.secondaryText}
                      />
                    </View>
                  </Pressable>
                  
                  {expandedSection === 'event' && (
                    <ScrollView style={styles.filterOptions} bounces={false}>
                      {[
                        { id: 'Nationals', label: 'Nationals' },
                        { id: 'Virus Series', label: 'Virus Series' },
                        { id: 'Virus Finals', label: 'Virus Finals' },
                      ].map((event) => (
                        <Pressable
                          key={event.id}
                          style={({ pressed }) => [
                            styles.filterOption,
                            { borderBottomColor: colors.border },
                            tempFilters.event === event.id && { backgroundColor: colors.pressed },
                            pressed && { opacity: 0.8 }
                          ]}
                          onPress={() => {
                            setTempFilters(prev => ({ ...prev, event: event.id as Event }));
                            setExpandedSection(null);
                          }}
                        >
                          <ThemedText style={[
                            styles.filterOptionText,
                            { color: colors.text },
                            tempFilters.event === event.id && { color: '#007AFF' }
                          ]}>
                            {event.label}
                          </ThemedText>
                          {tempFilters.event === event.id && (
                            <IconSymbol name="checkmark" size={16} color="#007AFF" />
                          )}
                        </Pressable>
                      ))}
                    </ScrollView>
                  )}
                </View>

                {/* Gender Filter */}
                <View style={[styles.filterSection, { borderBottomColor: colors.border }]}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.filterSectionButton,
                      { borderBottomColor: colors.border },
                      pressed && { opacity: 0.8 }
                    ]}
                    onPress={() => setExpandedSection(
                      expandedSection === 'gender' ? null : 'gender'
                    )}
                  >
                    <View style={styles.filterSectionButtonContent}>
                      <View>
                        <ThemedText style={[styles.filterSectionLabel, { color: colors.secondaryText }]}>
                          Gender
                        </ThemedText>
                        <ThemedText style={[styles.filterSectionValue, { color: colors.text }]}>
                          {tempFilters.gender}
                        </ThemedText>
                      </View>
                      <IconSymbol 
                        name={expandedSection === 'gender' ? 'chevron.down' : 'chevron.right'} 
                        size={16} 
                        color={colors.secondaryText}
                      />
                    </View>
                  </Pressable>
                  
                  {expandedSection === 'gender' && (
                    <ScrollView style={styles.filterOptions} bounces={false}>
                      {[
                        { id: 'Men', label: 'Men' },
                        { id: 'Women', label: 'Women' },
                      ].map((gender) => (
                        <Pressable
                          key={gender.id}
                          style={({ pressed }) => [
                            styles.filterOption,
                            { borderBottomColor: colors.border },
                            tempFilters.gender === gender.id && { backgroundColor: colors.pressed },
                            pressed && { opacity: 0.8 }
                          ]}
                          onPress={() => {
                            setTempFilters(prev => ({ ...prev, gender: gender.id as Gender }));
                            setExpandedSection(null);
                          }}
                        >
                          <ThemedText style={[
                            styles.filterOptionText,
                            { color: colors.text },
                            tempFilters.gender === gender.id && { color: '#007AFF' }
                          ]}>
                            {gender.label}
                          </ThemedText>
                          {tempFilters.gender === gender.id && (
                            <IconSymbol name="checkmark" size={16} color="#007AFF" />
                          )}
                        </Pressable>
                      ))}
                    </ScrollView>
                  )}
                </View>

                {/* Age Group Filter */}
                <View style={styles.filterSection}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.filterSectionButton,
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
                          {tempFilters.ageGroup[0].toUpperCase() + tempFilters.ageGroup.slice(1)}
                        </ThemedText>
                      </View>
                      <IconSymbol 
                        name={expandedSection === 'ageGroup' ? 'chevron.down' : 'chevron.right'} 
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
                      {[
                        { id: 'Senior', label: 'Senior' },
                        { id: 'U25', label: 'U25' },
                        { id: 'U23', label: 'U23' },
                        { id: 'University', label: 'University' },
                        { id: 'Junior', label: 'Junior' },
                        { id: 'U17', label: 'U17' },
                        { id: 'U15', label: 'U15' },
                        { id: 'U13', label: 'U13' },
                      ].map((ageGroup) => (
                        <Pressable
                          key={ageGroup.id}
                          style={({ pressed }) => [
                            styles.filterOption,
                            { borderBottomColor: colors.border },
                            tempFilters.ageGroup === ageGroup.id && { backgroundColor: colors.pressed },
                            pressed && { opacity: 0.8 }
                          ]}
                          onPress={() => {
                            setTempFilters(prev => ({ ...prev, ageGroup: ageGroup.id as AgeGroup }));
                            setExpandedSection(null);
                          }}
                        >
                          <ThemedText style={[
                            styles.filterOptionText,
                            { color: colors.text },
                            tempFilters.ageGroup === ageGroup.id && { color: '#007AFF' }
                          ]}>
                            {ageGroup.label}
                          </ThemedText>
                          {tempFilters.ageGroup === ageGroup.id && (
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
  filterContainer: {
    padding: 16,
  },
  filterButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  filterButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 12,
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
  filterButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  card: {
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
  headerRow: {
    flexDirection: 'row',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(60, 60, 67, 0.03)',
  },
  headerCell: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    padding: 16,
  },
  cell: {
    flex: 1,
    fontSize: 17,
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
    maxHeight: '80%', // Fallback if windowHeight not available
  },
  modalScrollContent: {
    flexGrow: 0,  // Changed from 1 to 0
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
  },
  modalFooter: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
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