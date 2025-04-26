import { StyleSheet, View, ScrollView, Pressable, Modal, Dimensions } from 'react-native';
import { Stack } from 'expo-router';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { useTheme } from '@/contexts/ThemeContext';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { useState, useEffect, useMemo } from 'react';
import { fetchQualifyingTotals, QualifyingTotalsData } from '@/data/fetch-qualifying-totals';

type Gender = 'Men' | 'Women';
type Event = 'USAW Nationals' | 'Virus Series' | 'Virus Finals' | 'IMWA Worlds' | 'Master\'s Pan Ams';
type AgeGroup =  'U11' |'U13' | 'U15' | 'U17' | 'Junior' | 'University' | 'U23' | 'U25' | 'Senior' | 'Masters 30' | 'Masters 35' | 'Masters 40' | 'Masters 45' | 'Masters 50' | 'Masters 55' | 'Masters 60' | 'Masters 65' | 'Masters 70' | 'Masters 75' | 'Masters 80' | 'Masters 85';

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
    event: 'USAW Nationals',
    gender: 'Men',
    ageGroup: 'Senior'
  });
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [expandedSection, setExpandedSection] = useState<'event' | 'gender' | 'ageGroup' | null>(null);
  const [tempFilters, setTempFilters] = useState<Filters>(filters);
  const [totals, setTotals] = useState<QualifyingTotalsData | null>(null);
  const [allTotals, setAllTotals] = useState<QualifyingTotalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setTotals(null);
    setFetchError(null);

    // Fetch only the current page first
    fetchQualifyingTotals(filters.event, filters.ageGroup, filters.gender)
      .then((data) => {
        if (!cancelled) {
          setTotals(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchError(err.message || 'Failed to fetch qualifying totals');
          setLoading(false);
        }
      });

    // Then fetch all totals in the background
    fetchQualifyingTotals()
      .then((data) => {
        if (!cancelled) setAllTotals(data);
      });

    return () => { cancelled = true; };
  }, [filters.event, filters.ageGroup, filters.gender]);

  // Use the full cache if available, otherwise just the current page
  const totalsData = useMemo(() => {
    return allTotals || totals || {};
  }, [allTotals, totals]);

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
    // Defensive: check all keys exist
    const eventData = totalsData[filters.event];
    if (!eventData) return [];
    const ageData = eventData[filters.ageGroup];
    if (!ageData) return [];
    const genderData = ageData[filters.gender];
    if (!genderData) return [];
    // genderData is now { [weightClass]: number }
    return Object.entries(genderData).map(([weightClass, qt]) => ({
      bodyweightDivision: weightClass,
      qt
    }));
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

          {loading ? (
            <View style={[styles.row, { flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: 120 }]}> 
              <ThemedText style={[styles.cell, { flex: 2, textAlign: 'center' }]}>Loading...</ThemedText>
            </View>
          ) : fetchError ? (
            <View style={styles.row}>
              <ThemedText style={[styles.cell, { flex: 2 }]}>{fetchError}</ThemedText>
            </View>
          ) : (
            getCurrentTotals().map((record, index, array) => (
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
            ))
          )}
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
                        { id: 'USAW Nationals', label: 'USAW Nationals' },
                        { id: 'Virus Series', label: 'Virus Series' },
                        { id: 'Virus Finals', label: 'Virus Finals' },
                        { id: 'IMWA Worlds', label: 'IMWA Worlds' },
                        { id: 'Master\'s Pan Ams', label: 'Master\'s Pan Ams' },
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
                         { id: 'U11', label: 'U11' },
                         { id: 'U13', label: 'U13' },
                         { id: 'U15', label: 'U15' },
                         { id: 'U17', label: 'U17' },
                         { id: 'Junior', label: 'Junior' },
                         { id: 'University', label: 'University' },
                         { id: 'U23', label: 'U23' },
                         { id: 'U25', label: 'U25' },
                        { id: 'Senior', label: 'Senior' },
                        { id: 'Masters 30', label: 'Masters 30' },
                        { id: 'Masters 35', label: 'Masters 35' },
                        { id: 'Masters 40', label: 'Masters 40' },
                        { id: 'Masters 45', label: 'Masters 45' },
                        { id: 'Masters 50', label: 'Masters 50' },
                        { id: 'Masters 55', label: 'Masters 55' },
                        { id: 'Masters 60', label: 'Masters 60' },
                        { id: 'Masters 65', label: 'Masters 65' },
                        { id: 'Masters 70', label: 'Masters 70' },
                        { id: 'Masters 75', label: 'Masters 75' },
                        { id: 'Masters 80', label: 'Masters 80' },
                        { id: 'Masters 85', label: 'Masters 85' },
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