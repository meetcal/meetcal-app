import { StyleSheet, View, ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { useTheme } from '@/contexts/ThemeContext';
import { americanRecords } from '@/data/records';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useState } from 'react';

export default function RecordsScreen() {
  const { currentTheme } = useTheme();
  const [selectedGender, setSelectedGender] = useState<'men' | 'women'>('men');

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
  };

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ 
        title: "American Records",
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

      <View style={styles.segmentedControlContainer}>
        <SegmentedControl
          values={['Men', 'Women']}
          selectedIndex={selectedGender === 'men' ? 0 : 1}
          onChange={(index) => setSelectedGender(index === 0 ? 'men' : 'women')}
        />
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

          {americanRecords[selectedGender].map((record, index) => (
            <View 
              key={record.weightClass}
              style={[
                styles.row,
                index < americanRecords[selectedGender].length - 1 && {
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
  segmentedControlContainer: {
    padding: 16,
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