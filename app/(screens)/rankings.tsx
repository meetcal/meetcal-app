import React, { useState, useEffect, useMemo } from 'react';
import { StyleSheet, View, ScrollView, Pressable, Modal, Dimensions } from 'react-native';
import { Stack } from 'expo-router';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { useTheme } from '@/contexts/ThemeContext';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { fetchIntlRankings, IntlRanking } from '@/lib/database/fetchIntlRankings';

interface Filters {
  meet: string;
  age_category: string;
  gender: string;
}

const windowHeight = Dimensions.get('window').height;
const maxOptionsHeight = windowHeight * 0.4;

// Number of rows to load initially
const PAGE_SIZE = 30;

export default function RecordsScreen() {
  const { currentTheme } = useTheme();
  const [filters, setFilters] = useState<Filters>({
    meet: '',
    age_category: '',
    gender: ''
  });
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [expandedSection, setExpandedSection] = useState<'meet' | 'age_category' | 'gender' | null>(null);
  const [tempFilters, setTempFilters] = useState<Filters>(filters);

  const [intlRankings, setIntlRankings] = useState<IntlRanking[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [backgroundLoading, setBackgroundLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setIntlRankings([]);
    setFetchError(null);

    fetchIntlRankings()
      .then((data) => {
        if (cancelled) return;
        setIntlRankings(data.slice(0, PAGE_SIZE));
        setLoading(false);
        // If more data, load the rest in background
        if (data.length > PAGE_SIZE) {
          setBackgroundLoading(true);
          setTimeout(() => {
            if (cancelled) return;
            setIntlRankings(data);
            setBackgroundLoading(false);
          }, 0);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchError(err.message || 'Failed to fetch rankings');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [filters.meet, filters.age_category, filters.gender]);

  // Only set default filters the first time rankings are loaded
  const [hasSetDefaultFilters, setHasSetDefaultFilters] = useState(false);
  useEffect(() => {
    if (!hasSetDefaultFilters && intlRankings.length > 0) {
      setFilters(prev => ({
        meet: typeof intlRankings[0].meet === 'string' ? intlRankings[0].meet : '',
        age_category: 'Senior',
        gender: 'Men',
      }));
      setTempFilters(prev => ({
        meet: typeof intlRankings[0].meet === 'string' ? intlRankings[0].meet : '',
        age_category: 'Senior',
        gender: 'Men',
      }));
      setHasSetDefaultFilters(true);
    }
    // Only set once, when data first arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intlRankings.length, hasSetDefaultFilters]);

  // Dynamically build filter options from the fetched data
  const meetOptions = useMemo(() => Array.from(new Set(intlRankings.map(r => typeof r.meet === 'string' ? r.meet : ''))).filter(Boolean), [intlRankings]);
  const ageCategoryOptions = useMemo(() => Array.from(new Set(intlRankings.map(r => typeof r.age_category === 'string' ? r.age_category : ''))).filter(Boolean), [intlRankings]);
  const genderOptions = useMemo(() => Array.from(new Set(intlRankings.map(r => typeof r.gender === 'string' ? r.gender : ''))).filter(Boolean), [intlRankings]);

  // Filter intlRankings based on selected filters
  const filteredRankings = useMemo(() => {
    return intlRankings.filter(r =>
      (!filters.meet || r.meet === filters.meet) &&
      (!filters.age_category || r.age_category === filters.age_category) &&
      (!filters.gender || r.gender === filters.gender)
    );
  }, [intlRankings, filters]);

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
    link: '#007AFF',
  };

  const getFilterDisplayText = () => {
    const meet = filters.meet;
    const age_category = filters.age_category;
    const gender = filters.gender;
    return `${meet} • ${age_category} • ${gender}`;
  };

  const handleApplyFilters = () => {
    setFilters(tempFilters);
    setShowFilterModal(false);
    setExpandedSection(null);
  };

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ 
        title: `International Rankings`,
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

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <ScrollView horizontal showsHorizontalScrollIndicator={true}>
          <View style={[styles.card, { backgroundColor: colors.card, minWidth: 600 }]}>
            <View style={[styles.headerRow, { borderBottomColor: colors.border }]}> 
              <ThemedText style={[styles.headerCell, { flex: 1 }]}>Rank</ThemedText>
              <ThemedText style={[styles.headerCell, { flex: 2.5 }]}>Name</ThemedText>
              <ThemedText style={[styles.headerCell, { flex: 2 }]}>Weight Class</ThemedText>
              <ThemedText style={[styles.headerCell, { flex: 2 }]}>Total</ThemedText>
              <ThemedText style={[styles.headerCell, { flex: 2 }]}>% of A</ThemedText>
            </View>

            {loading && (
              <ThemedText style={{ textAlign: 'center', marginTop: 16 }}>Loading...</ThemedText>
            )}
            {fetchError && (
              <ThemedText style={{ color: 'red', textAlign: 'center', marginTop: 16 }}>{fetchError}</ThemedText>
            )}
            {!loading && filteredRankings.length === 0 && (
              <ThemedText style={{ textAlign: 'center', marginTop: 16, color: colors.secondaryText }}>
                No rankings available.
              </ThemedText>
            )}
            {!loading && filteredRankings.length > 0 && (
              filteredRankings.map((ranking: IntlRanking, index: number) => (
                <View 
                  key={index}
                  style={[styles.row, index < filteredRankings.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
                >
                  <ThemedText style={[styles.cell, { flex: 1 }]}>{ranking.ranking ?? ''}</ThemedText>
                  <ThemedText style={[styles.cell, { flex: 2.5 }]}>{ranking.name ?? ''}</ThemedText>
                  <ThemedText style={[styles.cell, { flex: 2 }]}>{ranking.weight_class ?? ''}</ThemedText>
                  <ThemedText style={[styles.cell, { flex: 2 }]}>{ranking.total ?? ''}</ThemedText>
                  <ThemedText style={[styles.cell, { flex: 2 }]}>{typeof ranking.percent_a === 'number' ? `${ranking.percent_a.toFixed(2)}%` : ''}</ThemedText>
                </View>
              ))
            )}
            {backgroundLoading && (
              <ThemedText style={{ textAlign: 'center', marginTop: 8, color: colors.secondaryText }}>
                Loading more results...
              </ThemedText>
            )}
          </View>
        </ScrollView>
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
                      onPress={() => setExpandedSection(expandedSection === 'meet' ? null : 'meet')}
                    >
                      <View style={styles.filterSectionButtonContent}>
                        <View>
                          <ThemedText style={[styles.filterSectionLabel, { color: colors.secondaryText }]}>Meet</ThemedText>
                          <ThemedText style={[styles.filterSectionValue, { color: colors.text }]}>{tempFilters.meet}</ThemedText>
                        </View>
                        <IconSymbol name={expandedSection === 'meet' ? 'chevron.down' : 'chevron.right'} size={16} color={colors.secondaryText} />
                      </View>
                    </Pressable>
                    {expandedSection === 'meet' && (
                      <ScrollView style={[styles.filterOptions, { borderTopColor: colors.border }]} bounces={false}>
                        {meetOptions.map((meet) => (
                          <Pressable
                            key={meet}
                            style={({ pressed }) => [
                              styles.filterOption,
                              { borderBottomColor: colors.border },
                              tempFilters.meet === meet && { backgroundColor: colors.pressed },
                              pressed && { opacity: 0.8 }
                            ]}
                            onPress={() => {
                              setTempFilters(prev => ({ ...prev, meet: meet ?? '' }));
                              setExpandedSection(null);
                            }}
                          >
                            <ThemedText style={[
                              styles.filterOptionText,
                              { color: colors.text },
                              tempFilters.meet === meet && { color: colors.link }
                            ]}>
                              {meet}
                            </ThemedText>
                            {tempFilters.meet === meet && (
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
                      onPress={() => setExpandedSection(expandedSection === 'age_category' ? null : 'age_category')}
                    >
                      <View style={styles.filterSectionButtonContent}>
                        <View>
                          <ThemedText style={[styles.filterSectionLabel, { color: colors.secondaryText }]}>Age Category</ThemedText>
                          <ThemedText style={[styles.filterSectionValue, { color: colors.text }]}>{tempFilters.age_category}</ThemedText>
                        </View>
                        <IconSymbol name={expandedSection === 'age_category' ? 'chevron.down' : 'chevron.right'} size={16} color={colors.secondaryText} />
                      </View>
                    </Pressable>
                    {expandedSection === 'age_category' && (
                      <ScrollView style={[styles.filterOptions, { borderTopColor: colors.border }]} bounces={false}>
                        {ageCategoryOptions.map((age_category) => (
                          <Pressable
                            key={age_category}
                            style={({ pressed }) => [
                              styles.filterOption,
                              { borderBottomColor: colors.border },
                              tempFilters.age_category === age_category && { backgroundColor: colors.pressed },
                              pressed && { opacity: 0.8 }
                            ]}
                            onPress={() => {
                              setTempFilters(prev => ({ ...prev, age_category: age_category ?? '' }));
                              setExpandedSection(null);
                            }}
                          >
                            <ThemedText style={[
                              styles.filterOptionText,
                              { color: colors.text },
                              tempFilters.age_category === age_category && { color: colors.link }
                            ]}>
                              {age_category}
                            </ThemedText>
                            {tempFilters.age_category === age_category && (
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
                              setTempFilters(prev => ({ ...prev, gender: gender ?? '' }));
                              setExpandedSection(null);
                            }}
                          >
                            <ThemedText style={[
                              styles.filterOptionText,
                              { color: colors.text },
                              tempFilters.gender === gender && { color: colors.link }
                            ]}>
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
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(60, 60, 67, 0.03)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    padding: 16,
  },
  headerCell: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cell: {
    fontSize: 17,
    textAlign: 'center',
    justifyContent: 'center',
    alignItems: 'center',
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