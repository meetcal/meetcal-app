import { StyleSheet, View, ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { useTheme } from '@/contexts/ThemeContext';
import { currentStandards } from '@/data/standards';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useState } from 'react';

export default function CurrentStandardsScreen() {
  const { currentTheme } = useTheme();
  const [selectedGender, setSelectedGender] = useState<'men' | 'women'>('men');
  const [selectedAgeGroup, setSelectedAgeGroup] = useState<'senior' | 'junior' | 'youth' | 'u15'>('senior');

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
  };

  const ageGroupLabels = ['U15', 'Youth', 'Junior', 'Senior'];
  const ageGroupValues = ['u15', 'youth', 'junior', 'senior'] as const;

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

      <View style={styles.controlsContainer}>
        <View style={styles.segmentedControlContainer}>
          <SegmentedControl
            values={['Men', 'Women']}
            selectedIndex={selectedGender === 'men' ? 0 : 1}
            onChange={(index) => setSelectedGender(index === 0 ? 'men' : 'women')}
          />
        </View>

        <View style={styles.segmentedControlContainer}>
          <SegmentedControl
            values={ageGroupLabels}
            selectedIndex={ageGroupValues.indexOf(selectedAgeGroup)}
            onChange={(index) => setSelectedAgeGroup(ageGroupValues[index])}
          />
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

          {currentStandards[selectedAgeGroup][selectedGender].map((record, index) => (
            <View 
              key={record.weightClass}
              style={[
                styles.row,
                index < currentStandards[selectedAgeGroup][selectedGender].length - 1 && {
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
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  controlsContainer: {
    gap: 8,
    padding: 16,
  },
  segmentedControlContainer: {
    // Remove padding since it's now handled by the container
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingTop: 0,
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
}); 