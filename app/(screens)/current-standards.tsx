import { StyleSheet, View, ScrollView, Pressable, Modal } from 'react-native';
import { Stack } from 'expo-router';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { useTheme } from '@/contexts/ThemeContext';
import { currentStandards } from '@/data/standards';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { useState } from 'react';

type Gender = 'men' | 'women';
type AgeGroup = 'senior' | 'junior' | 'youth' | 'u15';

interface Filters {
  gender: Gender;
  ageGroup: AgeGroup;
}

export default function CurrentStandardsScreen() {
  const { currentTheme } = useTheme();
  const [filters, setFilters] = useState<Filters>({
    gender: 'men',
    ageGroup: 'senior'
  });
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [filterType, setFilterType] = useState<'gender' | 'ageGroup'>('gender');

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
  };

  const handleFilterSelect = (value: string) => {
    if (filterType === 'gender') {
      setFilters(prev => ({ ...prev, gender: value as Gender }));
    } else {
      setFilters(prev => ({ ...prev, ageGroup: value as AgeGroup }));
    }
    setShowFilterModal(false);
  };

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ 
        title: "Current Standards",
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
              setFilterType('gender');
              setShowFilterModal(true);
            }}
          >
            <ThemedText style={[styles.filterButtonText, { color: colors.secondaryText }]}>
              {filters.gender === 'men' ? 'Men' : 'Women'}
            </ThemedText>
            <IconSymbol name="chevron.down" size={12} color={colors.secondaryText} />
          </Pressable>

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
              setFilterType('ageGroup');
              setShowFilterModal(true);
            }}
          >
            <ThemedText style={[styles.filterButtonText, { color: colors.secondaryText }]}>
              {filters.ageGroup.charAt(0).toUpperCase() + filters.ageGroup.slice(1)}
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
            <ThemedText style={styles.headerCell}>A Standard</ThemedText>
            <ThemedText style={styles.headerCell}>B Standard</ThemedText>
          </View>

          {currentStandards[filters.ageGroup][filters.gender].map((record, index) => (
            <View 
              key={record.weightClass}
              style={[
                styles.row,
                index < currentStandards[filters.ageGroup][filters.gender].length - 1 && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: colors.border
                }
              ]}
            >
              <ThemedText style={[styles.cell, { flex: 2 }]}>{record.weightClass}</ThemedText>
              <ThemedText style={styles.cell}>{record.a}kg</ThemedText>
              <ThemedText style={styles.cell}>{record.b}kg</ThemedText>
            </View>
          ))}
        </View>
      </ScrollView>

      <Modal
        visible={showFilterModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFilterModal(false)}
      >
        <Pressable 
          style={[styles.modalOverlay, { 
            backgroundColor: currentTheme === 'dark' 
              ? 'rgba(0,0,0,0.6)' 
              : 'rgba(0,0,0,0.4)' 
          }]}
          onPress={() => setShowFilterModal(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            {filterType === 'gender' ? (
              <>
                {(['men', 'women'] as Gender[]).map((gender) => (
                  <Pressable
                    key={gender}
                    style={({ pressed }) => [
                      styles.modalOption,
                      { borderBottomColor: colors.border },
                      filters.gender === gender && { backgroundColor: colors.pressed },
                      pressed && { opacity: 0.8 }
                    ]}
                    onPress={() => handleFilterSelect(gender)}
                  >
                    <ThemedText style={[
                      styles.modalOptionText,
                      { color: colors.text },
                      filters.gender === gender && { color: '#007AFF' }
                    ]}>
                      {gender === 'men' ? 'Men' : 'Women'}
                    </ThemedText>
                    {filters.gender === gender && (
                      <IconSymbol name="checkmark" size={16} color="#007AFF" />
                    )}
                  </Pressable>
                ))}
              </>
            ) : (
              <>
                {(['u15', 'youth', 'junior', 'senior'] as AgeGroup[]).map((ageGroup) => (
                  <Pressable
                    key={ageGroup}
                    style={({ pressed }) => [
                      styles.modalOption,
                      { borderBottomColor: colors.border },
                      filters.ageGroup === ageGroup && { backgroundColor: colors.pressed },
                      pressed && { opacity: 0.8 }
                    ]}
                    onPress={() => handleFilterSelect(ageGroup)}
                  >
                    <ThemedText style={[
                      styles.modalOptionText,
                      { color: colors.text },
                      filters.ageGroup === ageGroup && { color: '#007AFF' }
                    ]}>
                      {ageGroup === 'u15' ? 'U15' : 
                       ageGroup.charAt(0).toUpperCase() + ageGroup.slice(1)}
                    </ThemedText>
                    {filters.ageGroup === ageGroup && (
                      <IconSymbol name="checkmark" size={16} color="#007AFF" />
                    )}
                  </Pressable>
                ))}
              </>
            )}
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
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
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