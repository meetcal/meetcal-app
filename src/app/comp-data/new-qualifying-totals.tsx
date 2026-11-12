import { SLIDE_IN_FROM_RIGHT, stackHeaderOptions } from "@/lib/stack-header-options";
import { DataTable, dataTableStyles } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { SubscriptionGate } from "@/components/ui/SubscriptionGate";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { FilterSection, GenericFilterModal } from "@/components/ui/filters";
import { useAppColors } from "@/hooks/useAppColors";
import { useFilterState } from "@/hooks/useFilterState";
import { useRouteFilterKey } from "@/hooks/useRouteFilterKey";
import { DEEP_LINKS } from "@/utils/deepLinks";
import { useMutableResource } from "@/hooks/useMutableResource";
import {
  EMPTY_QUALIFYING_TOTALS,
  qualifyingTotalsResource,
} from "@/lib/database/fetch-qualifying-totals";
import {
  defaultQualifyingEvent,
  selectQualifyingTotals,
  sortQualifyingEvents,
} from "@/lib/comp-data-filters";
import { filterSummary } from "@/lib/filter-summary";
import { sortAgeGroups } from "@/lib/sortAgeGroups";
import { QualifyingTotalsFilters } from "@/types/qual_totals";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";

export default function QualifyingTotalsScreen() {
  return (
    <SubscriptionGate>
      <QualifyingTotalsScreenContent />
    </SubscriptionGate>
  );
}

function QualifyingTotalsScreenContent() {
  const screenInsets = useScreenHorizontalInsets();
  const colors = useAppColors();
  const routeParams = useLocalSearchParams<{
    event?: string;
    gender?: string;
    ageGroup?: string;
  }>();
  const defaultFilters = useMemo<QualifyingTotalsFilters>(
    () => ({
      // Empty until the totals load; then the newest season's Nationals.
      event: routeParams.event || "",
      gender: routeParams.gender || "Men",
      ageGroup: routeParams.ageGroup || "Senior",
    }),
    [routeParams.ageGroup, routeParams.event, routeParams.gender],
  );
  const filterResetKey = useRouteFilterKey(DEEP_LINKS.qualifyingTotals, [
    routeParams.event,
    routeParams.gender,
    routeParams.ageGroup,
  ]);
  const { filters, setFilters, setTempFilters, openFilters, filterModalProps } =
    useFilterState<QualifyingTotalsFilters>({
    defaultFilters,
    resetKey: filterResetKey,
  });
  const {
    data: totalsData,
    isInitialLoading,
    error: fetchError,
  } = useMutableResource({
    resource: qualifyingTotalsResource,
    params: [] as const,
    initialData: EMPTY_QUALIFYING_TOTALS,
  });

  const getFilterDisplayText = () => {
    const ageGroup = filters.ageGroup
      ? filters.ageGroup.charAt(0).toUpperCase() + filters.ageGroup.slice(1)
      : "";
    return filterSummary(
      [filters.event, filters.gender, ageGroup],
      "All qualifying totals",
    );
  };

  const totals = useMemo(
    () => selectQualifyingTotals(totalsData, filters),
    [totalsData, filters],
  );

  const eventOptions = useMemo(() => {
    return sortQualifyingEvents(
      Object.keys(totalsData ?? {}).filter((e) => typeof e === "string"),
    );
  }, [totalsData]);

  useEffect(() => {
    if (eventOptions.length === 0) {
      return;
    }

    const nextEvent = eventOptions.includes(filters.event)
      ? filters.event
      : defaultQualifyingEvent(eventOptions);
    const nextAgeGroups =
      nextEvent && totalsData[nextEvent]
        ? sortAgeGroups(
            Object.keys(totalsData[nextEvent]).filter(
              (ageGroup) => typeof ageGroup === "string",
            ),
            { includeExtended: true },
          )
        : [];
    const nextAgeGroup = nextAgeGroups.includes(filters.ageGroup)
      ? filters.ageGroup
      : (nextAgeGroups[0] ?? "");

    if (nextEvent === filters.event && nextAgeGroup === filters.ageGroup) {
      return;
    }

    setFilters((prev) => ({
      ...prev,
      event: nextEvent,
      ageGroup: nextAgeGroup,
    }));
    setTempFilters((prev) => ({
      ...prev,
      event: nextEvent,
      ageGroup: nextAgeGroup,
    }));
  }, [
    eventOptions,
    filters.ageGroup,
    filters.event,
    setFilters,
    setTempFilters,
    totalsData,
  ]);

  const buildFilterSections = (
    modalTempFilters: Record<string, string>,
  ): FilterSection[] => {
    const selectedEvent = modalTempFilters.event || filters.event;
    const modalAgeGroupOptions =
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
        options: modalAgeGroupOptions.map((age) => ({
          value: age,
          label: age.charAt(0).toUpperCase() + age.slice(1),
        })),
        dependsOn: ["event"],
      },
    ];
  };

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }, screenInsets]}
    >
      <Stack.Screen
        options={{
          ...stackHeaderOptions(colors),
          ...SLIDE_IN_FROM_RIGHT,
          title: "Qualifying Totals",
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
        loading={isInitialLoading}
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
        resultCount={(modalTempFilters) =>
          selectQualifyingTotals(totalsData, modalTempFilters).length
        }
        resultLabel="weight classes"
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
