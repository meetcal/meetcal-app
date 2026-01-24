import React, { useState, useEffect, useMemo } from 'react';
import { StyleSheet, View, ScrollView, Pressable, Modal, Dimensions, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { useTheme } from '@/contexts/ThemeContext';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { WeightClassRecord, RecordsData } from '@/types/records';
import { useSubscription } from '@/contexts/SubscriptionContext';
import PaywallScreen from './paywall';
import { fetchAgeGroups } from '@/lib/database/fetch-records';
import { fetchAdaptiveRecords } from '@/lib/database/fetch-adaptive-records';

type Gender = 'Men' | 'Women';
type AgeGroup = string;

// Helper to create an empty RecordsData structure
const EMPTY_RECORDS_DATA: RecordsData = {} as RecordsData;

interface Filters {
  gender: Gender;
  ageGroup: AgeGroup;
}

const windowHeight = Dimensions.get('window').height;
const maxOptionsHeight = windowHeight * 0.4;


export default function AdaptiveRecordsScreen() {
  const { currentTheme } = useTheme();
  const { isSubscribed, isLoading: isSubscriptionLoading } = useSubscription();
  const [availableAgeGroups, setAvailableAgeGroups] = useState<string[]>([]);
  
  const [filters, setFilters] = useState<Filters>({
    gender: 'Men',
    ageGroup: 'Senior'
  });
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [expandedSection, setExpandedSection] = useState<'gender' | 'ageGroup' | null>(null);
  const [tempFilters, setTempFilters] = useState<Filters>(filters);

  const [records, setRecords] = useState<RecordsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Effect to load initial age groups
  useEffect(() => {
    async function loadAgeGroups() {
      try {
        // For adaptive records, we can use any federation to get age groups
        // Let's use USAW as the default
        const ageGroups = await fetchAgeGroups('USAW');
        setAvailableAgeGroups(ageGroups);
        
        // Set Senior as default if available, otherwise use first available
        if (ageGroups.includes('Senior')) {
          setFilters(prev => ({ ...prev, ageGroup: 'Senior' }));
          setTempFilters(prev => ({ ...prev, ageGroup: 'Senior' }));
        } else if (ageGroups.length > 0) {
          setFilters(prev => ({ ...prev, ageGroup: ageGroups[0] }));
          setTempFilters(prev => ({ ...prev, ageGroup: ageGroups[0] }));
        }
      } catch (err) {
        console.error('Failed to load age groups:', err);
        // Set a default age group
        setAvailableAgeGroups(['Senior']);
      }
    }
    loadAgeGroups();
  }, []);

  // Effect for syncing tempFilters when modal opens
  useEffect(() => {
    if (showFilterModal) {
      setTempFilters(filters);
    }
  }, [showFilterModal, filters]);

  // Effect for fetching adaptive records when filters change
  useEffect(() => {
    if (!filters.ageGroup) return; // Wait for age group to be set
    
    let cancelled = false;
    setLoading(true);
    setRecords(null);
    setFetchError(null);

    fetchAdaptiveRecords(filters.gender, filters.ageGroup)
      .then((data) => {
        if (!cancelled) {
          setRecords(data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchError(err.message || 'Failed to fetch adaptive records');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [filters.gender, filters.ageGroup]);

  const recordsData = useMemo(() => {
    return records || EMPTY_RECORDS_DATA;
  }, [records]);

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
    link: '#007AFF',
  };

  const getAgeGroupDisplayText = (ageGroup: AgeGroup | undefined) => {
    if (!ageGroup) return '';
    // Simple display: capitalize first letter if not a 'u' category like 'u13'
    if (ageGroup.startsWith('u') && ageGroup.length > 1 && !isNaN(Number(ageGroup.substring(1,3)))) {
        return ageGroup.toUpperCase().replace('U', 'U'); // e.g. U13, U15
    }
    return ageGroup.charAt(0).toUpperCase() + ageGroup.slice(1);
  };

  const getFilterDisplayText = () => {
    const gen = filters.gender === 'Men' ? 'Men' : 'Women';
    const age = getAgeGroupDisplayText(filters.ageGroup) || 'N/A';
    return `${gen} • ${age}`;
  };

  const handleApplyFilters = () => {
    setFilters(tempFilters);
    setShowFilterModal(false);
    setExpandedSection(null);
  };

  if (isSubscriptionLoading) {
    return (
      <ThemedView style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.link} />
      </ThemedView>
    );
  }

  if (!isSubscribed) {
    return <PaywallScreen />;
  }

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ 
        title: `Adaptive Records`,
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
          {!loading && !fetchError && (!recordsData[filters.ageGroup] || recordsData[filters.ageGroup]?.[filters.gender]?.length === 0) && (
            <ThemedText style={{ textAlign: 'center', marginTop: 16, color: colors.secondaryText }}>
              No adaptive records available for {filters.gender === 'Men' ? 'men' : 'women'} in the {getAgeGroupDisplayText(filters.ageGroup)} age group.
            </ThemedText>
          )}
          {!loading && !fetchError && recordsData[filters.ageGroup]?.[filters.gender]?.length > 0 && (
            recordsData[filters.ageGroup][filters.gender].map((record: WeightClassRecord, index: number) => (
              <View 
                key={`adaptive-${filters.gender}-${filters.ageGroup}-${record.weightClass}-${index}`}
                style={[
                  styles.row,
                  index < recordsData[filters.ageGroup][filters.gender].length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border
                  }
                ]}
              >
                <ThemedText style={[styles.cell, { flex: 2 }]}>{record.weightClass}kg</ThemedText>
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
                  {/* Gender Section */}
                  <View style={[styles.filterSection, { borderBottomColor: colors.border }]}>
                    <Pressable
                      style={({ pressed }) => [styles.filterSectionButton, pressed && { opacity: 0.8 } ]}
                      onPress={() => setExpandedSection(expandedSection === 'gender' ? null : 'gender')}
                    >
                      <View style={styles.filterSectionButtonContent}>
                        <View>
                          <ThemedText style={[styles.filterSectionLabel, { color: colors.secondaryText }]}>Gender</ThemedText>
                          <ThemedText style={[styles.filterSectionValue, { color: colors.text }]}>{tempFilters.gender === 'Men' ? 'Men' : 'Women'}</ThemedText>
                        </View>
                        <IconSymbol name={expandedSection === 'gender' ? 'chevron.down' : 'chevron.right'} size={16} color={colors.secondaryText} />
                      </View>
                    </Pressable>
                    {expandedSection === 'gender' && (
                      <ScrollView style={[styles.filterOptions, { borderTopColor: colors.border }]} bounces={false}>
                        {(['Men', 'Women'] as Gender[]).map((gender) => (
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
                              {gender === 'Men' ? 'Men' : 'Women'}
                            </ThemedText>
                            {tempFilters.gender === gender && (
                              <IconSymbol name="checkmark" size={16} color={colors.link} />
                            )}
                          </Pressable>
                        ))}
                      </ScrollView>
                    )}
                  </View>

                  {/* Age Group Section */}
                  <View style={styles.filterSection}>
                    <Pressable
                      style={({ pressed }) => [styles.filterSectionButton, pressed && { opacity: 0.8 } ]}
                      onPress={() => setExpandedSection(expandedSection === 'ageGroup' ? null : 'ageGroup')}
                    >
                      <View style={styles.filterSectionButtonContent}>
                        <View>
                          <ThemedText style={[styles.filterSectionLabel, { color: colors.secondaryText }]}>Age Group</ThemedText>
                          <ThemedText style={[styles.filterSectionValue, { color: colors.text }]}>
                            {getAgeGroupDisplayText(tempFilters.ageGroup) || 'Select...'}
                          </ThemedText>
                        </View>
                        <IconSymbol name={expandedSection === 'ageGroup' ? 'chevron.down' : 'chevron.right'} size={16} color={colors.secondaryText} />
                      </View>
                    </Pressable>
                    {expandedSection === 'ageGroup' && (
                      <ScrollView style={[styles.filterOptions, { maxHeight: maxOptionsHeight, borderTopColor: colors.border }]} bounces={false}>
                        {availableAgeGroups.length === 0 && <ThemedText style={{padding: 16, color: colors.secondaryText}}>Loading age groups...</ThemedText>}
                        {availableAgeGroups.map((ageGroup) => (
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
