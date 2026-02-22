import { DataTable, dataTableStyles } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { SubscriptionGate } from "@/components/ui/SubscriptionGate";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { FilterSection, GenericFilterModal } from "@/components/ui/filters";
import { useAppColors } from "@/hooks/useAppColors";
import { useFetchData } from "@/hooks/useFetchData";
import { useFilterState } from "@/hooks/useFilterState";
import {
  fetchQualifyingTotals,
  QualifyingTotalsData,
} from "@/lib/database/fetch-qualifying-totals";
import { sortAgeGroups } from "@/lib/sortAgeGroups";
import { Filters } from "@/types/qual_totals";
import { Stack } from "expo-router";
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";

export default function QualifyingTotalsScreen() {
  const colors = useAppColors();
  const { filters, openFilters, filterModalProps } = useFilterState<Filters>({
    defaultFilters: { event: "Nationals", gender: "Men", ageGroup: "Senior" },
  });
  const {
    data: totalsData,
    loading,
    error: fetchError,
  } = useFetchData<QualifyingTotalsData>(
    fetchQualifyingTotals,
    {} as QualifyingTotalsData,
    [],
  );

  const getFilterDisplayText = () => {
    const parts = [];
    parts.push(filters.event);
    parts.push(filters.gender);
    if (filters.ageGroup) {
      parts.push(filters.ageGroup[0].toUpperCase() + filters.ageGroup.slice(1));
    }
    return parts.join(" • ");
  };

  const totals = useMemo(() => {
    // Defensive: check all keys exist
    const eventData = totalsData[filters.event];
    if (!eventData) return [];
    const ageData = eventData[filters.ageGroup];
    if (!ageData) return [];
    const genderData = ageData[filters.gender as 'Men' | 'Women'];
    if (!genderData) return [];
    // genderData is now { [weightClass]: number }
    return Object.entries(genderData).map(([weightClass, qt]) => ({
      bodyweightDivision: weightClass,
      qt,
    }));
  }, [totalsData, filters.event, filters.ageGroup, filters.gender]);

  const eventOptions = useMemo(() => {
    return Object.keys(totalsData ?? {})
      .filter((e) => typeof e === "string")
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [totalsData]);

  const buildFilterSections = (
    modalTempFilters: Record<string, string>,
  ): FilterSection[] => {
    const selectedEvent = modalTempFilters.event || filters.event;
    const ageGroupOptions =
      selectedEvent && totalsData[selectedEvent]
        ? sortAgeGroups(
            Object.keys(totalsData[selectedEvent]).filter(
              (ageGroup) => typeof ageGroup === "string",
            ),
            { includeExtended: true },
          )
        : [];

    return [
      {
        id: "event",
        title: "Event",
        options: eventOptions.map((event) => ({ value: event, label: event })),
        allOptionLabel: "All Events",
      },
      {
        id: "gender",
        title: "Gender",
        options: [
          { value: "Men", label: "Men" },
          { value: "Women", label: "Women" },
        ],
      },
      {
        id: "ageGroup",
        title: "Age Group",
        options: ageGroupOptions.map((age) => ({
          value: age,
          label: age.charAt(0).toUpperCase() + age.slice(1),
        })),
        allOptionLabel: "All Ages",
        dependsOn: ["event"],
      },
    ];
  };

  return (
    <SubscriptionGate>
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Stack.Screen
        options={{
          title: "Qualifying Totals",
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
          { label: "Total" },
        ]}
        data={totals}
        keyExtractor={(record) => record.bodyweightDivision}
        loading={loading}
        error={fetchError}
        renderRow={(record, index) => (
          <View
            style={[
              dataTableStyles.row,
              index < totals.length - 1 && {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: colors.border,
              },
            ]}
          >
            <ThemedText style={[dataTableStyles.cell, { flex: 2 }]}>
              {record.bodyweightDivision}
            </ThemedText>
            <ThemedText style={dataTableStyles.cell}>
              {record.qt}
              kg
            </ThemedText>
          </View>
        )}
      />

      <GenericFilterModal
        {...filterModalProps}
        sections={buildFilterSections}
        resultCount={totals.length}
        resultLabel="weight classes"
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
