import React, { useState, useEffect, useMemo } from 'react';
import { StyleSheet, View, ScrollView, Pressable, Modal, Dimensions, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { useTheme } from '@/contexts/ThemeContext';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { fetchIntlRankings, IntlRanking } from '@/lib/database/fetchIntlRankings';
import { useSubscription } from '@/contexts/SubscriptionContext';
import PaywallScreen from './paywall';

interface Filters {
  meet: string;
  age_category: string;
  gender: string;
}

const windowHeight = Dimensions.get('window').height;
const maxOptionsHeight = windowHeight * 0.4;

// Number of rows to load initially
const PAGE_SIZE = 30;

// --- Define Fixed Column Widths ---
// Adjust these values as needed for your content and desired layout
const columnWidths = {
  rank: 60,
  name: 200, // Give more space for names
  weightClass: 100,
  total: 80,
  percentA: 100,
};

// Calculate minimum total width based on fixed widths
// Add paddingHorizontal * 2 from row/headerRow style if cells don't have their own padding
const totalPadding = 16 * 2; // From styles.row/headerRow paddingHorizontal
const minTableWidth = Object.values(columnWidths).reduce((sum, width) => sum + width, 0);


export default function RecordsScreen() {
  const { currentTheme } = useTheme();
  const { isSubscribed, isLoading: isSubscriptionLoading } = useSubscription();
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
  }, []);

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
  const meetOptions = useMemo(
    () => Array.from(new Set(intlRankings.map(r => typeof r.meet === 'string' ? r.meet : '')))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
    [intlRankings]
  );
  
  // Filter age category options based on the selected meet in tempFilters
  const ageCategoryOptions = useMemo(
    () => {
      const filteredData = tempFilters.meet 
        ? intlRankings.filter(r => r.meet === tempFilters.meet)
        : intlRankings;
      
      return Array.from(new Set(filteredData.map(r => typeof r.age_category === 'string' ? r.age_category : '')))
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    },
    [intlRankings, tempFilters.meet]
  );
  
  const genderOptions = useMemo(
    () => Array.from(new Set(intlRankings.map(r => typeof r.gender === 'string' ? r.gender : '')))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
    [intlRankings]
  );

  // Filter intlRankings based on selected filters and sort by rank
  const filteredRankings = useMemo(() => {
    return intlRankings
      .filter(r =>
        (!filters.meet || r.meet === filters.meet) &&
        (!filters.age_category || r.age_category === filters.age_category) &&
        (!filters.gender || r.gender === filters.gender)
      )
      .sort((a, b) => {
        // Handle cases where ranking might be null/undefined
        const rankA = a.ranking ?? Number.MAX_SAFE_INTEGER;
        const rankB = b.ranking ?? Number.MAX_SAFE_INTEGER;
        return rankA - rankB;
      });
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

      {/* --- TABLE SECTION START --- */}
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <ScrollView horizontal showsHorizontalScrollIndicator={true}>
          {/* Apply minWidth to the container View */}
          <View style={[styles.card, { backgroundColor: colors.card, minWidth: minTableWidth }]}>
            {/* Header Row */}
            <View style={[styles.headerRow, { borderBottomColor: colors.border }]}>
              <ThemedText style={[styles.headerCell, { width: columnWidths.rank }]}>Rank</ThemedText>
              <ThemedText style={[styles.headerCell, { width: columnWidths.name }]}>Name</ThemedText>
              <ThemedText style={[styles.headerCell, { width: columnWidths.weightClass }]}>Weight Class</ThemedText>
              <ThemedText style={[styles.headerCell, { width: columnWidths.total }]}>Total</ThemedText>
              <ThemedText style={[styles.headerCell, { width: columnWidths.percentA }]}>% of A Standard</ThemedText>
            </View>

            {/* Loading/Error/Empty/Data States (single ternary for exclusivity) */}
            {loading ? (
              <ThemedText style={styles.statusText}>Loading...</ThemedText>
            ) : fetchError ? (
              <ThemedText style={[styles.statusText, { color: 'red' }]}>{fetchError}</ThemedText>
            ) : (!loading && filteredRankings.length === 0 && intlRankings.length > 0) ? (
              <ThemedText style={[styles.statusText, { color: colors.secondaryText }]}>No rankings available.</ThemedText>
            ) : (
              <>
                {filteredRankings.map((ranking: IntlRanking, index: number) => (
                  <View
                    key={index}
                    style={[styles.row, index < filteredRankings.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
                  >
                    <ThemedText style={[styles.cell, { width: columnWidths.rank }]}>{ranking.ranking ?? ''}</ThemedText>
                    <ThemedText style={[styles.cell, { width: columnWidths.name }]}>{ranking.name ?? ''}</ThemedText>
                    <ThemedText style={[styles.cell, { width: columnWidths.weightClass }]}>{ranking.weight_class ?? ''}kg</ThemedText>
                    <ThemedText style={[styles.cell, { width: columnWidths.total }]}>{ranking.total ?? ''}</ThemedText>
                    <ThemedText style={[styles.cell, { width: columnWidths.percentA }]}>{typeof ranking.percent_a === 'number' ? `${ranking.percent_a.toFixed(2)}%` : ''}</ThemedText>
                  </View>
                ))}
                {backgroundLoading && filteredRankings.length > 0 && (
                  <ThemedText style={[styles.statusText, { marginTop: 8, color: colors.secondaryText }]}>Loading more results...</ThemedText>
                )}
              </>
            )}
          </View>
        </ScrollView>
      </ScrollView>
      {/* --- TABLE SECTION END --- */}


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
                      <ScrollView style={[styles.filterOptions, { borderTopColor: colors.border, maxHeight: maxOptionsHeight }]} bounces={false}>
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
                              const newMeet = meet ?? '';
                              setTempFilters(prev => {
                                // Get available age categories for the new meet
                                const meetData = intlRankings.filter(r => r.meet === newMeet);
                                const availableAgeCategories = Array.from(new Set(meetData.map(r => r.age_category).filter(Boolean)));
                                
                                // Reset age category if current selection is not available for new meet
                                const newAgeCategory = availableAgeCategories.includes(prev.age_category as any) 
                                  ? prev.age_category 
                                  : (availableAgeCategories.length > 0 ? availableAgeCategories[0] as string : '');
                                
                                return { 
                                  ...prev, 
                                  meet: newMeet,
                                  age_category: newAgeCategory
                                };
                              });
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
                      <ScrollView style={[styles.filterOptions, { borderTopColor: colors.border, maxHeight: maxOptionsHeight }]} bounces={false}>
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
                      <ScrollView style={[styles.filterOptions, { borderTopColor: colors.border, maxHeight: maxOptionsHeight }]} bounces={false}>
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
    borderBottomWidth: StyleSheet.hairlineWidth,
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: 16, // Keep vertical padding
    paddingHorizontal: 0, // Remove horizontal padding here, apply to card/rows if needed
    alignItems: 'flex-start', // Align the horizontal scrollview container to the start
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
    marginHorizontal: 16, // Add horizontal margin to the card itself
    // minWidth is set dynamically inline
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    // No paddingHorizontal here, width is controlled by cells
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(60, 60, 67, 0.03)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    // No paddingHorizontal here, width is controlled by cells
    paddingVertical: 12,
  },
  headerCell: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center', // Center text within the cell
    paddingHorizontal: 4, // Add small horizontal padding within cells if needed
    // width is applied inline
  },
  cell: {
    fontSize: 17,
    textAlign: 'center', // Center text within the cell
    paddingHorizontal: 4, // Add small horizontal padding within cells if needed
    // width is applied inline
  },
  statusText: {
    textAlign: 'center',
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 16, // Add padding to status text as it's outside the row structure
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  modalContent: {
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
});
