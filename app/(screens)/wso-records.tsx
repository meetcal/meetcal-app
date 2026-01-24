import React, { useState, useEffect, useMemo } from 'react';
import { StyleSheet, View, ScrollView, Pressable, Modal, Dimensions, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { useTheme } from '@/contexts/ThemeContext';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { WeightClassRecord, RecordsData, AgeGroupRecords } from '@/types/records';
import { fetchWSORecords, fetchWSOList, fetchWSOAgeGroups } from '@/lib/database/fetch-wso-records';
import { useSubscription } from '@/contexts/SubscriptionContext';
import PaywallScreen from './paywall';

type Gender = 'Men' | 'Women';

interface Filters {
  wso: string;
  gender: Gender;
  ageGroup: string;
}

const windowHeight = Dimensions.get('window').height;
const maxOptionsHeight = windowHeight * 0.4;

export default function RecordsScreen() {
  const { currentTheme } = useTheme();
  const [availableWSOs, setAvailableWSOs] = useState<string[]>([]);
  const [availableAgeGroups, setAvailableAgeGroups] = useState<string[]>([]);
  const { isSubscribed, isLoading: isSubscriptionLoading } = useSubscription();

  const [filters, setFilters] = useState<Filters>({
    wso: '',
    gender: 'Men',
    ageGroup: 'Senior',
  });
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [expandedSection, setExpandedSection] = useState<'wso' | 'gender' | 'ageGroup' | null>(null);
  const [tempFilters, setTempFilters] = useState<Filters>(filters);

  const [records, setRecords] = useState<RecordsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [allRecords, setAllRecords] = useState<RecordsData | null>(null);

  useEffect(() => {
    async function fetchWSOs() {
      try {
        const wsos = await fetchWSOList();
        setAvailableWSOs(wsos);
        if (wsos.length > 0) {
          setFilters(f => ({ ...f, wso: wsos[0] }));
          setTempFilters(f => ({ ...f, wso: wsos[0] }));
        }
      } catch (error) {
        setFetchError('Failed to load WSOs');
      }
    }
    fetchWSOs();
  }, []);

  useEffect(() => {
    if (!tempFilters.wso) return;
    async function fetchAgeGroupsForWSO() {
      try {
        let ageGroups = Array.from(new Set(await fetchWSOAgeGroups(tempFilters.wso)));
      const order = ['u11','u13', 'u15', 'u17', 'youth','junior', 'senior'];
      ageGroups = ageGroups.sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        const aIdx = order.indexOf(aLower);
        const bIdx = order.indexOf(bLower);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        // Masters sort
        const mastersA = aLower.startsWith('masters');
        const mastersB = bLower.startsWith('masters');
        if (mastersA && mastersB) {
          // Extract number after 'Masters'
          const numA = parseInt(aLower.replace(/[^0-9]/g, ''));
          const numB = parseInt(bLower.replace(/[^0-9]/g, ''));
          return numA - numB;
        }
        if (mastersA) return 1;
        if (mastersB) return -1;
        // Otherwise, alphabetical
        return a.localeCompare(b);
      });
      setAvailableAgeGroups(ageGroups);
      if (ageGroups.length > 0 && !ageGroups.includes(tempFilters.ageGroup)) {
        setTempFilters(prev => ({ ...prev, ageGroup: ageGroups[0] }));
      }
      } catch (error) {
        setFetchError('Failed to load age groups');
      }
    }
    fetchAgeGroupsForWSO();
  }, [tempFilters.wso]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRecords(null);
    setFetchError(null);

    if (!filters.wso || !filters.ageGroup) return;
    fetchWSORecords(filters.wso, filters.ageGroup, filters.gender)
      .then((data) => {
        if (!cancelled) {
          setRecords(data);
          setAllRecords(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchError(err.message || 'Failed to fetch records');
          setLoading(false);
        }
      });
    fetchWSORecords(filters.wso)
      .then((data) => {
        if (!cancelled) setAllRecords(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [filters.wso, filters.ageGroup, filters.gender]);

  const recordsData = useMemo<RecordsData | null>(() => {
    return records || allRecords || null;
  }, [records, allRecords]);

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
    link: '#007AFF',
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

  const getAgeGroupDisplayText = (ageGroup: string) => {
    if (!ageGroup) return '';
    switch (ageGroup) {
      case 'u13': return 'U13';
      case 'u15': return 'U15';
      case 'u17': return 'U17';
      default: return ageGroup.charAt(0).toUpperCase() + ageGroup.slice(1);
    }
  };

  const getFilterDisplayText = () => {
    const wso = filters.wso;
    const gen = filters.gender;
    const age = getAgeGroupDisplayText(filters.ageGroup);
    return `${wso} • ${gen} • ${age}`;
  };

  const handleApplyFilters = () => {
    setFilters(tempFilters);
    setShowFilterModal(false);
    setExpandedSection(null);
  };

  const genderOptions = (['Men', 'Women'] as Gender[]).sort((a, b) => a.localeCompare(b));

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ 
        title: `WSO Records`,
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
          {fetchError && !loading && (
            <ThemedText style={{ color: 'red', textAlign: 'center', marginTop: 16 }}>{fetchError}</ThemedText>
          )}
          {!loading && !fetchError && (
            !recordsData || 
            !recordsData[filters.ageGroup as keyof RecordsData] || 
            recordsData[filters.ageGroup as keyof RecordsData]?.[filters.gender as keyof AgeGroupRecords]?.length === 0
          ) && (
            <ThemedText style={{ textAlign: 'center', marginTop: 16, color: colors.secondaryText }}>
              No {filters.wso} records available for {filters.gender} in the {getAgeGroupDisplayText(filters.ageGroup)} age group.
            </ThemedText>
          )}
          {!loading && !fetchError && recordsData && 
            recordsData[filters.ageGroup as keyof RecordsData]?.[filters.gender as keyof AgeGroupRecords]?.length > 0 && (
            recordsData[filters.ageGroup as keyof RecordsData]?.[filters.gender as keyof AgeGroupRecords]?.map((record: WeightClassRecord, index: number) => (
              <View 
                key={`${filters.wso}-${filters.ageGroup}-${filters.gender}-${record.weightClass}`}
                style={[
                  styles.row,
                  index < (recordsData[filters.ageGroup as keyof RecordsData]?.[filters.gender as keyof AgeGroupRecords]?.length ?? 0) - 1 && {
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
                  <View style={[styles.filterSection, { borderBottomColor: colors.border }]}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.filterSectionButton,
                        pressed && { opacity: 0.8 }
                      ]}
                      onPress={() => setExpandedSection(expandedSection === 'wso' ? null : 'wso')}
                    >
                      <View style={styles.filterSectionButtonContent}>
                        <View>
                          <ThemedText style={[styles.filterSectionLabel, { color: colors.secondaryText }]}>WSO</ThemedText>
                          <ThemedText style={[styles.filterSectionValue, { color: colors.text }]}>{tempFilters.wso}</ThemedText>
                        </View>
                        <IconSymbol name={expandedSection === 'wso' ? 'chevron.down' : 'chevron.right'} size={16} color={colors.secondaryText} />
                      </View>
                    </Pressable>
                    {expandedSection === 'wso' && (
                      <ScrollView style={[styles.filterOptions, { maxHeight: maxOptionsHeight, borderTopColor: colors.border }]} bounces={false}>
                        {availableWSOs.map((wso) => (
                          <Pressable
                            key={wso}
                            style={({ pressed }) => [
                              styles.filterOption,
                              { borderBottomColor: colors.border },
                              tempFilters.wso === wso && { backgroundColor: colors.pressed },
                              pressed && { opacity: 0.8 }
                            ]}
                            onPress={() => {
                              setTempFilters(prev => ({ ...prev, wso }));
                              setExpandedSection(null);
                            }}
                          >
                            <ThemedText
                              style={[
                                styles.filterOptionText,
                                { color: colors.text },
                                tempFilters.wso === wso && { color: colors.link }
                              ]}
                            >
                              {wso}
                            </ThemedText>
                            {tempFilters.wso === wso && (
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
                          <ThemedText style={[styles.filterSectionValue, { color: colors.text }]}>{tempFilters.gender}</ThemedText>
                        </View>
                        <IconSymbol name={expandedSection === 'gender' ? 'chevron.down' : 'chevron.right'} size={16} color={colors.secondaryText} />
                      </View>
                    </Pressable>
                    {expandedSection === 'gender' && (
                      <ScrollView style={[styles.filterOptions, { borderTopColor: colors.border }]} bounces={false}>
                        {genderOptions.map((gender) => (
                          <Pressable
                            key={gender}
                            style={({ pressed }) => [
                              styles.filterOption,
                              { borderBottomColor: colors.border },
                              tempFilters.gender === gender && { backgroundColor: colors.pressed },
                              pressed && { opacity: 0.8 }
                            ]}
                            onPress={() => {
                              setTempFilters(prev => ({ ...prev, gender }));
                              setExpandedSection(null);
                            }}
                          >
                            <ThemedText
                              style={[
                                styles.filterOptionText,
                                { color: colors.text },
                                tempFilters.gender === gender && { color: colors.link }
                              ]}
                            >
                              {gender}
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
                        {availableAgeGroups.map((age) => (
                          <Pressable
                            key={age}
                            style={({ pressed }) => [
                              styles.filterOption,
                              { borderBottomColor: colors.border },
                              tempFilters.ageGroup === age && { backgroundColor: colors.pressed },
                              pressed && { opacity: 0.8 }
                            ]}
                            onPress={() => {
                              setTempFilters(prev => ({ ...prev, ageGroup: age }));
                              setExpandedSection(null);
                            }}
                          >
                            <ThemedText style={[
                              styles.filterOptionText,
                              { color: colors.text },
                              tempFilters.ageGroup === age && { color: colors.link }
                            ]}>
                              {getAgeGroupDisplayText(age)}
                            </ThemedText>
                            {tempFilters.ageGroup === age && (
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
