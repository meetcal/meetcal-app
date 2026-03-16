import { DataTable, dataTableStyles } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { SubscriptionGate } from "@/components/ui/SubscriptionGate";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { FilterSection, GenericFilterModal } from "@/components/ui/filters";
import { useAppColors } from "@/hooks/useAppColors";
import { useFilterState } from "@/hooks/useFilterState";
import { useMutableResource } from "@/hooks/useMutableResource";
import { standardsResource } from "@/lib/database/fetch-standards";
import { AgeGroup, Filters, Gender, StandardsData } from "@/types/standards";
import { Stack } from "expo-router";
import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";


export default function NewStandardsScreen() {
  const colors = useAppColors();
  const { filters, openFilters, filterModalProps } = useFilterState<Filters>({
    defaultFilters: { gender: "men", ageGroup: "senior" },
  });

  const {
    data: allStandards,
    isInitialLoading,
    error: fetchError,
  } = useMutableResource({
    resource: standardsResource,
    params: [] as const,
    initialData: {} as StandardsData,
  });

  const standardsData = useMemo(() => {
    if (!allStandards[filters.ageGroup]) return [];
    if (!allStandards[filters.ageGroup][filters.gender]) return [];
    return allStandards[filters.ageGroup][filters.gender];
  }, [allStandards, filters.ageGroup, filters.gender]);

  const getFilterDisplayText = () => {
    const genderText = filters.gender === "men" ? "Men" : "Women";
    const ageGroupText =
      filters.ageGroup === "u15"
        ? "U15"
        : filters.ageGroup.charAt(0).toUpperCase() + filters.ageGroup.slice(1);
    return `${genderText} • ${ageGroupText}`;
  };

  const genderOptions: { id: Gender; label: string }[] = [
    { id: "men", label: "Men" },
    { id: "women", label: "Women" },
  ];

  const ageGroupOptions: { id: AgeGroup; label: string }[] = [
    { id: "u15", label: "U15" },
    { id: "youth", label: "Youth" },
    { id: "junior", label: "Junior" },
    { id: "senior", label: "Senior" },
  ];

  const filterSections: FilterSection[] = [
    {
      id: "gender",
      title: "Gender",
      options: genderOptions.map((g) => ({ value: g.id, label: g.label })),
    },
    {
      id: "ageGroup",
      title: "Age Group",
      options: ageGroupOptions.map((a) => ({ value: a.id, label: a.label })),
    },
  ];

  return (
    <SubscriptionGate>
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Stack.Screen
        options={{
          title: "A/B Standards",
          headerBackTitle: "Back",
          headerShown: true,
          gestureEnabled: true,
          gestureDirection: "horizontal",
          animation: "slide_from_right",
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
        }}
      />

      <FilterBar
        displayText={getFilterDisplayText()}
        onPress={openFilters}
      />

      <DataTable
        columns={[
          { label: "Weight Class", flex: 2 },
          { label: "A" },
          { label: "B" },
        ]}
        data={standardsData}
        keyExtractor={(record) => record.weightClass}
        loading={isInitialLoading}
        error={fetchError}
        emptyMessage="No standards found for the selected filters."
        renderRow={(record, index) => (
          <View
            style={[
              dataTableStyles.row,
              index < standardsData.length - 1 && {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: colors.border,
              },
            ]}
          >
            <ThemedText style={[dataTableStyles.cell, { flex: 2 }]}>
              {record.weightClass}
            </ThemedText>
            <ThemedText style={dataTableStyles.cell}>
              {record.a}
              kg
            </ThemedText>
            <ThemedText style={dataTableStyles.cell}>
              {record.b}
              kg
            </ThemedText>
          </View>
        )}
      />

      <GenericFilterModal
        {...filterModalProps}
        sections={filterSections}
        resultCount={standardsData.length}
        resultLabel="standards"
      />
    </ThemedView>
    </SubscriptionGate>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
