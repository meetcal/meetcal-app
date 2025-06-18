import React from 'react';
import { StyleSheet, View, ScrollView, Pressable, Modal, Dimensions, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { useTheme } from '@/contexts/ThemeContext';
import { fetchStandards } from '@/lib/database/fetch-standards';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { useState, useEffect, useMemo } from 'react';
import { useSubscription } from '@/contexts/SubscriptionContext';
import PaywallScreen from './paywall';

type Gender = 'men' | 'women';
type AgeGroup = 'senior' | 'junior' | 'youth' | 'u15';

interface Filters {
  gender: Gender;
  ageGroup: AgeGroup;
}

interface StandardsData {
  [ageGroup: string]: {
    [gender: string]: {
      weightClass: string;
      a: number;
      b: number;
    }[];
  };
}

const windowHeight = Dimensions.get('window').height;
const maxOptionsHeight = windowHeight * 0.4;

export default function NewStandardsScreen() {
  const { currentTheme } = useTheme();
  const { isSubscribed, isLoading: isSubscriptionLoading } = useSubscription();
  const [filters, setFilters] = useState<Filters>({
    gender: 'men',
    ageGroup: 'senior'
  });
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [expandedSection, setExpandedSection] = useState<'gender' | 'ageGroup' | null>(null);
  const [tempFilters, setTempFilters] = useState<Filters>(filters);

  const [standards, setStandards] = useState<StandardsData | null>(null);
  const [allStandards, setAllStandards] = useState<StandardsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setStandards(null);
    setFetchError(null);

    // Fetch only the current page first
    fetchStandards(filters.ageGroup, filters.gender)
      .then((data) => {
        if (!cancelled) {
          setStandards(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchError(err.message || 'Failed to fetch standards');
          setLoading(false);
        }
      });

    // Then fetch all standards in the background
    fetchStandards()
      .then((data) => {
        if (!cancelled) setAllStandards(data);
      });

    return () => { cancelled = true; };
  }, [filters.ageGroup, filters.gender]);

  const standardsData = useMemo(() => {
    const dataToUse = allStandards || standards || {};
    if (!dataToUse[filters.ageGroup]) return [];
    if (!dataToUse[filters.ageGroup][filters.gender]) return [];
    return dataToUse[filters.ageGroup][filters.gender];
  }, [allStandards, standards, filters.ageGroup, filters.gender]);

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
  };

  const getFilterDisplayText = () => {
    const genderText = filters.gender === 'men' ? 'Men' : 'Women';
    const ageGroupText = filters.ageGroup === 'u15' ? 'U15' : filters.ageGroup.charAt(0).toUpperCase() + filters.ageGroup.slice(1);
    return `${genderText} • ${ageGroupText}`;
  };

  const handleApplyFilters = () => {
    setFilters(tempFilters);
    setShowFilterModal(false);
    setExpandedSection(null);
  };

  const genderOptions: { id: Gender; label: string }[] = [
    { id: 'men', label: 'Men' },
    { id: 'women', label: 'Women' },
  ];

  const ageGroupOptions: { id: AgeGroup; label: string }[] = [
    { id: 'u15', label: 'U15' },
    { id: 'youth', label: 'Youth' },
    { id: 'junior', label: 'Junior' },
    { id: 'senior', label: 'Senior' },
  ];

  if (isSubscriptionLoading) {
    return (
      <ThemedView style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#007AFF" />
      </ThemedView>
    );
  }

  if (!isSubscribed) {
    return <PaywallScreen />;
  }

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ 
        title: "A/B Standards",
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
            <ThemedText style={styles.headerCell}>A</ThemedText>
            <ThemedText style={styles.headerCell}>B</ThemedText>
          </View>

          {loading && (
            <ThemedText style={{ textAlign: 'center', marginTop: 16 }}>Loading...</ThemedText>
          )}
          {fetchError && (
            <ThemedText style={{ color: 'red', textAlign: 'center', marginTop: 16 }}>{fetchError}</ThemedText>
          )}
          {standardsData && standardsData.length > 0 ? standardsData.map((record, index) => (
            <View 
              key={record.weightClass}
              style={[
                styles.row,
                index < standardsData.length - 1 && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: colors.border
                }
              ]}
            >
              <ThemedText style={[styles.cell, { flex: 2 }]}>{record.weightClass}</ThemedText>
              <ThemedText style={styles.cell}>{record.a}kg</ThemedText>
              <ThemedText style={styles.cell}>{record.b}kg</ThemedText>
            </View>
          )) : !loading && !fetchError && (
             <View style={[styles.row, { flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: 120 }]}>
                <ThemedText style={[styles.cell, { flex: 1, textAlign: 'center' }]}>No standards found for the selected filters.</ThemedText>
             </View>
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
          <Pressable
             onPress={(e) => e.stopPropagation()}
             style={[
               styles.modalContent,
               {
                 backgroundColor: colors.card,
                 maxHeight: windowHeight * 0.8
               }
             ]}
           >
            <View style={styles.modalScrollContent}>
              <ScrollView bounces={false}>
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
                          {tempFilters.gender === 'men' ? 'Men' : 'Women'}
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
                      {genderOptions.map((gender) => (
                        <Pressable
                          key={gender.id}
                          style={({ pressed }) => [
                            styles.filterOption,
                            { borderBottomColor: colors.border },
                            tempFilters.gender === gender.id && { backgroundColor: colors.pressed },
                            pressed && { opacity: 0.8 }
                          ]}
                          onPress={() => {
                            setTempFilters(prev => ({ ...prev, gender: gender.id }));
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
                          {ageGroupOptions.find(opt => opt.id === tempFilters.ageGroup)?.label || tempFilters.ageGroup}
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
                      {ageGroupOptions.map((ageGroup) => (
                        <Pressable
                          key={ageGroup.id}
                          style={({ pressed }) => [
                            styles.filterOption,
                            { borderBottomColor: colors.border },
                            tempFilters.ageGroup === ageGroup.id && { backgroundColor: colors.pressed },
                            pressed && { opacity: 0.8 }
                          ]}
                          onPress={() => {
                            setTempFilters(prev => ({ ...prev, ageGroup: ageGroup.id }));
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
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
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
    justifyContent: 'center',
    padding: 16,
  },
  modalContent: {
    borderRadius: 12,
    overflow: 'hidden',
    marginHorizontal: 16,
    maxHeight: '80%',
  },
  modalScrollContent: {
     flexGrow: 0,
  },
  filterSection: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterSectionButton: {
    padding: 16,
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
    paddingVertical: 10,
    width: '100%',
    alignItems: 'center',
    borderRadius: 8,
  },
  applyButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
}); 