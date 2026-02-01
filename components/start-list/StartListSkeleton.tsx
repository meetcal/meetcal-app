import React, { useCallback } from 'react';
import { View, StyleSheet, ScrollView, Animated } from 'react-native';
import { ThemedView } from '@/components/ThemedView';

interface StartListSkeletonProps {
  colors: { background: string; card: string; border: string };
  currentTheme: 'light' | 'dark';
  skeletonPulse: Animated.Value;
}

const skeletonStyles = StyleSheet.create({
  block: { borderRadius: 6 },
  icon: { width: 16, height: 16, borderRadius: 8 },
  searchLine: { height: 12, width: '70%', borderRadius: 6 },
  buttonIcon: { width: 14, height: 14, borderRadius: 7 },
  buttonText: { height: 12, width: '60%', borderRadius: 6 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  line: { height: 14, width: '55%', borderRadius: 6 },
  tiny: { width: 24, height: 12, borderRadius: 6 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { height: 12, width: 90, borderRadius: 6 },
  value: { height: 12, width: 140, borderRadius: 6 },
  valueShort: { height: 12, width: 90, borderRadius: 6 },
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  filterContainer: { padding: 16 },
  searchContainer: { marginBottom: 6 },
  searchBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, gap: 8 },
  buttonRow: { flexDirection: 'row', gap: 16, marginTop: 6 },
  button: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  athleteCard: { borderRadius: 12, overflow: 'hidden', marginBottom: 12 },
  detailsContainer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
});

export function StartListSkeleton({ colors, currentTheme, skeletonPulse }: StartListSkeletonProps) {
  const SkeletonBlock = useCallback(({ style }: { style: object }) => {
    const backgroundColor = currentTheme === 'dark' ? '#2C2C2E' : '#E6E6EA';
    return (
      <Animated.View
        style={[skeletonStyles.block, { backgroundColor, opacity: skeletonPulse }, style]}
      />
    );
  }, [currentTheme, skeletonPulse]);

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[
        skeletonStyles.filterContainer,
        { backgroundColor: colors.background, borderBottomColor: currentTheme === 'dark' ? '#2C2C2E' : '#C6C6C8', borderBottomWidth: 1 }
      ]}>
        <View style={skeletonStyles.searchContainer}>
          <View style={[skeletonStyles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SkeletonBlock style={skeletonStyles.icon} />
            <SkeletonBlock style={skeletonStyles.searchLine} />
          </View>
        </View>
        <View style={skeletonStyles.buttonRow}>
          <View style={[skeletonStyles.button, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SkeletonBlock style={skeletonStyles.buttonIcon} />
            <SkeletonBlock style={skeletonStyles.buttonText} />
          </View>
          <View style={[skeletonStyles.button, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SkeletonBlock style={skeletonStyles.buttonIcon} />
            <SkeletonBlock style={skeletonStyles.buttonText} />
          </View>
        </View>
      </View>
      <ScrollView contentContainerStyle={skeletonStyles.content}>
        {[0, 1, 2, 3].map((index) => (
          <View key={`skeleton-${index}`} style={[skeletonStyles.athleteCard, { backgroundColor: colors.card }]}>
            <View style={skeletonStyles.cardHeader}>
              <SkeletonBlock style={skeletonStyles.line} />
              <SkeletonBlock style={skeletonStyles.tiny} />
            </View>
            <View style={[skeletonStyles.detailsContainer, { borderTopColor: colors.border }]}>
              <View style={skeletonStyles.detailRow}>
                <SkeletonBlock style={skeletonStyles.label} />
                <SkeletonBlock style={skeletonStyles.value} />
              </View>
              <View style={skeletonStyles.detailRow}>
                <SkeletonBlock style={skeletonStyles.label} />
                <SkeletonBlock style={skeletonStyles.valueShort} />
              </View>
              <View style={skeletonStyles.detailRow}>
                <SkeletonBlock style={skeletonStyles.label} />
                <SkeletonBlock style={skeletonStyles.valueShort} />
              </View>
            </View>
          </View>
        ))}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
