import React, { useState, useEffect, useMemo } from 'react';
import { StyleSheet, View, ScrollView, Pressable, Modal, Dimensions } from 'react-native';
import { Stack } from 'expo-router';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { useTheme } from '@/contexts/ThemeContext';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { WeightClassRecord, RecordsData } from '@/types/records';
import { fetchRecords } from '@/data/fetch-records';

type Federation = 'USAW' | 'USAMW';
type Gender = 'men' | 'women';
const USAW_AGE_GROUPS = [
  'u13', 'u15', 'u17', 'collegiate', 'junior', 'senior',
  'Masters 35-39', 'Masters 40-44', 'Masters 45-49', 'Masters 50-54',
  'Masters 55-59', 'Masters 60-64', 'Masters 65-69', 'Masters 70-74',
  'Masters 75-79', 'Masters 80-84', 'Masters 85-89', 'Masters +90'
] as const;
const USAMW_AGE_GROUPS = [
  'Masters 35-39', 'Masters 40-44', 'Masters 45-49', 'Masters 50-54',
  'Masters 55-59', 'Masters 60-64', 'Masters 65-69', 'Masters 70-74',
  'Masters 75-79', 'Masters 80-84', 'Masters 85-89', 'Masters +90'
] as const;

type USAWAgeGroup = typeof USAW_AGE_GROUPS[number];
type USAMWAgeGroup = typeof USAMW_AGE_GROUPS[number];
type AgeGroup = USAWAgeGroup | USAMWAgeGroup;

interface Filters {
  federation: Federation;
  gender: Gender;
  ageGroup: AgeGroup;
}

const windowHeight = Dimensions.get('window').height;
const maxOptionsHeight = windowHeight * 0.4;

export default function RecordsScreen() {
  const { currentTheme } = useTheme();
  const [filters, setFilters] = useState<Filters>({
    federation: 'USAW',
    gender: 'men',
    ageGroup: 'senior'
  });
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [expandedSection, setExpandedSection] = useState<'federation' | 'gender' | 'ageGroup' | null>(null);
  const [tempFilters, setTempFilters] = useState<Filters>(filters);

  const [records, setRecords] = useState<RecordsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Cache for all records for the selected federation
  const [allRecords, setAllRecords] = useState<RecordsData | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRecords(null);
    setFetchError(null);

    // Fetch only the current page first
    fetchRecords(filters.federation, filters.ageGroup, filters.gender)
      .then((data) => {
        if (!cancelled) {
          setRecords(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchError(err.message || 'Failed to fetch records');
          setLoading(false);
        }
      });

    // Then fetch all records for the federation in the background
    fetchRecords(filters.federation)
      .then((data) => {
        if (!cancelled) setAllRecords(data);
      });

    return () => { cancelled = true; };
  }, [filters.federation, filters.ageGroup, filters.gender]);

  // Use the full cache if available, otherwise just the current page
  const recordsData = useMemo(() => {
    return allRecords || records || {};
  }, [allRecords, records]);

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
    link: '#007AFF',
  };

  const { tempAvailableAgeGroups } = useMemo(() => {
    if (tempFilters.federation === 'USAW') {
      return { tempAvailableAgeGroups: USAW_AGE_GROUPS };
    } else {
      return { tempAvailableAgeGroups: USAMW_AGE_GROUPS };
    }
  }, [tempFilters.federation]);

  const { currentAvailableAgeGroups } = useMemo(() => {
    if (filters.federation === 'USAW') {
      return { currentAvailableAgeGroups: USAW_AGE_GROUPS };
    } else {
      return { currentAvailableAgeGroups: USAMW_AGE_GROUPS };
    }
  }, [filters.federation]);

  const isAgeGroupValid = currentAvailableAgeGroups.includes(filters.ageGroup as any);
  const displayAgeGroup = isAgeGroupValid ? filters.ageGroup : currentAvailableAgeGroups[0];

  const getAgeGroupDisplayText = (ageGroup: AgeGroup) => {
    if (!ageGroup) return '';
    switch (ageGroup) {
      case 'u13': return 'U13';
      case 'u15': return 'U15';
      case 'u17': return 'U17';
      default: return ageGroup.charAt(0).toUpperCase() + ageGroup.slice(1);
    }
  };

  const getFilterDisplayText = () => {
    const fed = filters.federation;
    const gen = filters.gender === 'men' ? 'Men' : 'Women';
    const age = getAgeGroupDisplayText(displayAgeGroup);
    return `${fed} • ${gen} • ${age}`;
  };

  const handleApplyFilters = () => {
    const federationAgeGroups = filters.federation === 'USAW' ? USAW_AGE_GROUPS : USAMW_AGE_GROUPS;
    if (!federationAgeGroups.includes(tempFilters.ageGroup as any)) {
      setFilters({...tempFilters, ageGroup: federationAgeGroups[0]});
    } else {
      setFilters(tempFilters);
    }
    setShowFilterModal(false);
    setExpandedSection(null);
  };

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ 
        title: `American Records`,
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
              setExpandedSection(null);
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
            <ThemedText style={styles.headerCell}>Snatch</ThemedText>
            <ThemedText style={styles.headerCell}>C&J</ThemedText>
            <ThemedText style={styles.headerCell}>Total</ThemedText>
          </View>

          {loading && (
            <ThemedText style={{ textAlign: 'center', marginTop: 16 }}>Loading...</ThemedText>
          )}
          {fetchError && (
            <ThemedText style={{ color: 'red', textAlign: 'center', marginTop: 16 }}>{fetchError}</ThemedText>
          )}
          {!loading && recordsData[displayAgeGroup]?.[filters.gender]?.length === 0 && (
            <ThemedText style={{ textAlign: 'center', marginTop: 16, color: colors.secondaryText }}>
              No {filters.federation} records available for {filters.gender === 'men' ? 'men' : 'women'} in the {getAgeGroupDisplayText(displayAgeGroup)} age group.
            </ThemedText>
          )}
          {!loading && recordsData[displayAgeGroup]?.[filters.gender]?.length > 0 && (
            recordsData[displayAgeGroup][filters.gender].map((record: WeightClassRecord, index: number) => (
              <View 
                key={`${filters.federation}-${displayAgeGroup}-${filters.gender}-${record.weightClass}`}
                style={[
                  styles.row,
                  index < recordsData[displayAgeGroup][filters.gender].length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border
                  }
                ]}
              >
                <ThemedText style={[styles.cell, { flex: 2 }]}>{record.weightClass}</ThemedText>
                <ThemedText style={styles.cell}>{record.snatchRecord}kg</ThemedText>
                <ThemedText style={styles.cell}>{record.cjRecord}kg</ThemedText>
                <ThemedText style={styles.cell}>{record.totalRecord}kg</ThemedText>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <Modal
        visible={showFilterModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setExpandedSection(null);
          setShowFilterModal(false);
        }}
      >
        <Pressable 
          style={[styles.modalOverlay, { 
            backgroundColor: currentTheme === 'dark' 
              ? 'rgba(0,0,0,0.6)' 
              : 'rgba(0,0,0,0.4)' 
          }]}
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
            <Pressable onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalScrollContent}>
                <ScrollView bounces={false}>
                  <View style={[styles.filterSection, { borderBottomColor: colors.border }]}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.filterSectionButton,
                        pressed && { opacity: 0.8 }
                      ]}
                      onPress={() => setExpandedSection(expandedSection === 'federation' ? null : 'federation')}
                    >
                      <View style={styles.filterSectionButtonContent}>
                        <View>
                          <ThemedText style={[styles.filterSectionLabel, { color: colors.secondaryText }]}>Federation</ThemedText>
                          <ThemedText style={[styles.filterSectionValue, { color: colors.text }]}>{tempFilters.federation}</ThemedText>
                        </View>
                        <IconSymbol name={expandedSection === 'federation' ? 'chevron.down' : 'chevron.right'} size={16} color={colors.secondaryText} />
                      </View>
                    </Pressable>
                    {expandedSection === 'federation' && (
                      <ScrollView style={[styles.filterOptions, { borderTopColor: colors.border }]} bounces={false}>
                        {(['USAW', 'USAMW'] as Federation[]).map((federation) => (
                          <Pressable
                            key={federation}
                            style={({ pressed }) => [
                              styles.filterOption,
                              { borderBottomColor: colors.border },
                              tempFilters.federation === federation && { backgroundColor: colors.pressed },
                              pressed && { opacity: 0.8 }
                            ]}
                            onPress={() => {
                              const newAgeGroup = federation === 'USAW' ? 'senior' : 'Masters 35-39';
                              setTempFilters(prev => ({ ...prev, federation: federation, ageGroup: newAgeGroup }));
                              setExpandedSection(null);
                            }}
                          >
                            <ThemedText style={[
                              styles.filterOptionText,
                              { color: colors.text },
                              tempFilters.federation === federation && { color: colors.link }
                            ]}>
                              {federation}
                            </ThemedText>
                            {tempFilters.federation === federation && (
                              <IconSymbol name="checkmark" size={16} color={colors.link} />
                            )}
                          </Pressable>
                        ))}
                      </ScrollView>
                    )}
                  </View>

                  <View style={[styles.filterSection, { borderBottomColor: colors.border }]}>
                    <Pressable
                      style={({ pressed }) => [styles.filterSectionButton, pressed && { opacity: 0.8 } ]}
                      onPress={() => setExpandedSection(expandedSection === 'gender' ? null : 'gender')}
                    >
                      <View style={styles.filterSectionButtonContent}>
                        <View>
                          <ThemedText style={[styles.filterSectionLabel, { color: colors.secondaryText }]}>Gender</ThemedText>
                          <ThemedText style={[styles.filterSectionValue, { color: colors.text }]}>{tempFilters.gender === 'men' ? 'Men' : 'Women'}</ThemedText>
                        </View>
                        <IconSymbol name={expandedSection === 'gender' ? 'chevron.down' : 'chevron.right'} size={16} color={colors.secondaryText} />
                      </View>
                    </Pressable>
                    {expandedSection === 'gender' && (
                      <ScrollView style={[styles.filterOptions, { borderTopColor: colors.border }]} bounces={false}>
                        {(['men', 'women'] as Gender[]).map((gender) => (
                          <Pressable
                            key={gender}
                            style={({ pressed }) => [
                              styles.filterOption,
                              { borderBottomColor: colors.border },
                              tempFilters.gender === gender && { backgroundColor: colors.pressed },
                              pressed && { opacity: 0.8 }
                            ]}
                            onPress={() => {
                              setTempFilters(prev => ({ ...prev, gender: gender }));
                              setExpandedSection(null);
                            }}
                          >
                            <ThemedText style={[
                              styles.filterOptionText,
                              { color: colors.text },
                              tempFilters.gender === gender && { color: colors.link }
                            ]}>
                              {gender === 'men' ? 'Men' : 'Women'}
                            </ThemedText>
                            {tempFilters.gender === gender && (
                              <IconSymbol name="checkmark" size={16} color={colors.link} />
                            )}
                          </Pressable>
                        ))}
                      </ScrollView>
                    )}
                  </View>

                  <View style={styles.filterSection}>
                    <Pressable
                      style={({ pressed }) => [styles.filterSectionButton, pressed && { opacity: 0.8 } ]}
                      onPress={() => setExpandedSection(expandedSection === 'ageGroup' ? null : 'ageGroup')}
                    >
                      <View style={styles.filterSectionButtonContent}>
                        <View>
                          <ThemedText style={[styles.filterSectionLabel, { color: colors.secondaryText }]}>Age Group</ThemedText>
                          <ThemedText style={[styles.filterSectionValue, { color: colors.text }]}>{getAgeGroupDisplayText(tempFilters.ageGroup)}</ThemedText>
                        </View>
                        <IconSymbol name={expandedSection === 'ageGroup' ? 'chevron.down' : 'chevron.right'} size={16} color={colors.secondaryText} />
                      </View>
                    </Pressable>
                    {expandedSection === 'ageGroup' && (
                      <ScrollView style={[styles.filterOptions, { maxHeight: maxOptionsHeight, borderTopColor: colors.border }]} bounces={false}>
                        {tempAvailableAgeGroups.map((ageGroup) => (
                          <Pressable
                            key={ageGroup}
                            style={({ pressed }) => [
                              styles.filterOption,
                              { borderBottomColor: colors.border },
                              tempFilters.ageGroup === ageGroup && { backgroundColor: colors.pressed },
                              pressed && { opacity: 0.8 }
                            ]}
                            onPress={() => {
                              setTempFilters(prev => ({ ...prev, ageGroup: ageGroup }));
                              setExpandedSection(null);
                            }}
                          >
                            <ThemedText style={[
                              styles.filterOptionText,
                              { color: colors.text },
                              tempFilters.ageGroup === ageGroup && { color: colors.link }
                            ]}>
                              {getAgeGroupDisplayText(ageGroup)}
                            </ThemedText>
                            {tempFilters.ageGroup === ageGroup && (
                              <IconSymbol name="checkmark" size={16} color={colors.link} />
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
  filterContainer: {
    padding: 16,
    backgroundColor: '#F5F5F5',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C6C6C8',
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
    gap: 8,
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
    borderRadius: 14,
    overflow: 'hidden',
    marginHorizontal: 24,
    maxHeight: '80%',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  modalScrollContent: {
    flexGrow: 0,
  },
  filterSection: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterSectionButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  filterSectionButtonContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  filterSectionLabel: {
    fontSize: 13,
    marginBottom: 2,
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
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterOptionText: {
    fontSize: 17,
  },
  modalFooter: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  applyButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 30,
    paddingVertical: 10,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  applyButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  emptyStateContainer: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateText: {
    fontSize: 17,
    textAlign: 'center',
  },
}); 