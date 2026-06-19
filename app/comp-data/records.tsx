import { DataTable, dataTableStyles } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { SubscriptionGate } from "@/components/ui/SubscriptionGate";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { FilterSection, GenericFilterModal } from "@/components/ui/filters";
import { useTheme } from "@/contexts/ThemeContext";
import { useAppColors } from "@/hooks/useAppColors";
import { useFilterState } from "@/hooks/useFilterState";
import { useMutableResource } from "@/hooks/useMutableResource";
import {
  federationRecordsResource,
  fetchAgeGroups,
} from "@/lib/database/fetch-records";
import { sortAgeGroups } from "@/lib/sortAgeGroups";
import { AgeGroup, Filters, Gender, RecordsData, WeightClassRecord } from "@/types/records";
import { Stack } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

const EMPTY_RECORDS_DATA: RecordsData = {} as RecordsData;
const HARDCODED_FEDERATIONS = ["USAW", "USAMW", "IWF", "UMWF", "BWL"];

export default function RecordsScreen() {
  return (
    <SubscriptionGate>
      <RecordsScreenContent />
    </SubscriptionGate>
  );
}

function RecordsScreenContent() {
  const colors = useAppColors();
  const { currentTheme } = useTheme();
  const [ageGroupsCache, setAgeGroupsCache] = useState<Record<string, string[]>>(
    {},
  );
  const modalDraftFederationRef = React.useRef("");

  const {
    filters,
    setFilters,
    setTempFilters,
    openFilters,
    filterModalProps,
  } = useFilterState<Filters>({
    defaultFilters: { federation: "", gender: "Men", ageGroup: "" },
  });

  const recordsParams = useMemo(
    () => (filters.federation ? ([filters.federation] as const) : null),
    [filters.federation],
  );
  const {
    data: allRecords,
    isInitialLoading: isRecordsLoading,
    error: recordsError,
  } = useMutableResource({
    resource: federationRecordsResource,
    params: (recordsParams ?? ([""] as const)) as [string],
    initialData: EMPTY_RECORDS_DATA,
    enabled: Boolean(recordsParams),
  });

  const loading = Boolean(filters.federation) && isRecordsLoading;
  const fetchError = recordsError;

  useEffect(() => {
    if (filters.federation) {
      return;
    }

    const defaults = {
      federation: "USAW",
      gender: "Men" as Gender,
      ageGroup: "Senior",
    };
    setFilters(defaults);
    setTempFilters(defaults);
  }, [filters.federation, setFilters, setTempFilters]);

  const ageGroupsForFederation = useMemo(
    () => sortAgeGroups(Object.keys(allRecords)),
    [allRecords],
  );

  useEffect(() => {
    if (!filters.federation || ageGroupsForFederation.length === 0) {
      return;
    }

    setAgeGroupsCache((prev) => {
      const current = prev[filters.federation] ?? [];
      if (JSON.stringify(current) === JSON.stringify(ageGroupsForFederation)) {
        return prev;
      }
      return {
        ...prev,
        [filters.federation]: ageGroupsForFederation,
      };
    });
  }, [ageGroupsForFederation, filters.federation]);

  useEffect(() => {
    if (!filters.federation || !ageGroupsForFederation.length) {
      return;
    }
    if (!ageGroupsForFederation.includes(filters.ageGroup)) {
      setFilters((prev) => ({ ...prev, ageGroup: ageGroupsForFederation[0] }));
      setTempFilters((prev) => ({ ...prev, ageGroup: ageGroupsForFederation[0] }));
    }
  }, [
    ageGroupsForFederation,
    filters.ageGroup,
    filters.federation,
    setFilters,
    setTempFilters,
  ]);

  const displayAgeGroup = useMemo(() => {
    if (ageGroupsForFederation.includes(filters.ageGroup)) {
      return filters.ageGroup;
    }
    return ageGroupsForFederation[0] || filters.ageGroup || "";
  }, [ageGroupsForFederation, filters.ageGroup]);

  const currentRecords = useMemo<WeightClassRecord[]>(() => {
    return allRecords[displayAgeGroup]?.[filters.gender as "Men" | "Women"] ?? [];
  }, [allRecords, displayAgeGroup, filters.gender]);

  const getAgeGroupDisplayText = (ageGroup: AgeGroup | undefined) => {
    if (!ageGroup) return "";
    if (
      ageGroup.startsWith("u") &&
      ageGroup.length > 1 &&
      !isNaN(Number(ageGroup.substring(1, 3)))
    ) {
      return ageGroup.toUpperCase();
    }
    return ageGroup.charAt(0).toUpperCase() + ageGroup.slice(1);
  };

  const getFilterDisplayText = () => {
    const fed = filters.federation || "USAW";
    const gen = filters.gender === "Men" ? "Men" : "Women";
    const age = getAgeGroupDisplayText(displayAgeGroup) || "Senior";
    return `${fed} • ${gen} • ${age}`;
  };

  const handleResetFilters = () => {
    const reset = {
      federation: "USAW",
      gender: "Men" as Gender,
      ageGroup: "Senior",
    };
    setFilters(reset);
    setTempFilters(reset);
  };

  const fetchAgeGroupsForFederation = React.useCallback(
    (federation: string) => {
      if (!federation || ageGroupsCache[federation]) return;

      fetchAgeGroups(federation)
        .then((nextAgeGroups) => {
          setAgeGroupsCache((prev) => ({
            ...prev,
            [federation]: sortAgeGroups(nextAgeGroups),
          }));
        })
        .catch((error) => {
          console.error(`Failed to fetch age groups for ${federation}`, error);
        });
    },
    [ageGroupsCache],
  );

  const buildFilterSections = React.useCallback(
    (modalTempFilters: Record<string, string>): FilterSection[] => {
      const selectedFederation =
        modalTempFilters.federation || filters.federation || "";

      if (
        selectedFederation &&
        selectedFederation !== filters.federation &&
        selectedFederation !== modalDraftFederationRef.current
      ) {
        modalDraftFederationRef.current = selectedFederation;
        fetchAgeGroupsForFederation(selectedFederation);
      }

      const modalAgeGroups =
        selectedFederation === filters.federation
          ? ageGroupsForFederation
          : ageGroupsCache[selectedFederation] ?? [];

      return [
        {
          id: "federation",
          title: "Federation",
          options: HARDCODED_FEDERATIONS.map((fed) => ({
            value: fed,
            label: fed,
          })),
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
          options: modalAgeGroups.map((ageGroup) => ({
            value: ageGroup,
            label: getAgeGroupDisplayText(ageGroup),
          })),
          dependsOn: ["federation"],
        },
      ];
    },
    [
      ageGroupsCache,
      ageGroupsForFederation,
      fetchAgeGroupsForFederation,
      filters.federation,
    ],
  );

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Stack.Screen
        options={{
          title: `Records`,
          headerBackTitle: "Back",
          headerShown: true,
          gestureEnabled: true,
          gestureDirection: "horizontal",
          animation: "slide_from_right",
          headerTitleStyle: {
            color: currentTheme === "dark" ? "#fff" : "#000",
          },
          headerStyle: {
            backgroundColor: currentTheme === "dark" ? "#000000" : "#F5F5F5",
          },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
          headerTintColor: colors.text,
        }}
      />

      <FilterBar
        displayText={getFilterDisplayText()}
        onPress={openFilters}
      />

      <DataTable
        columns={[
          { label: "Weight Class", flex: 2 },
          { label: "Snatch" },
          { label: "C&J" },
          { label: "Total" },
        ]}
        data={currentRecords}
        keyExtractor={(record, index) =>
          `${filters.federation}-${displayAgeGroup}-${filters.gender}-${record.weightClass}-${index}`
        }
        loading={loading}
        error={fetchError}
        emptyMessage={`No ${filters.federation} records available for ${filters.gender === "Men" ? "men" : "women"} in the ${getAgeGroupDisplayText(displayAgeGroup) || "selected"} age group.`}
        renderRow={(record, index) => (
          <View
            style={[
              dataTableStyles.row,
              index < currentRecords.length - 1 && {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: colors.border,
              },
            ]}
          >
            <ThemedText style={[dataTableStyles.cell, { flex: 2 }]}>
              {record.weightClass}
            </ThemedText>
            <ThemedText style={dataTableStyles.cell}>
              {record.snatchRecord}
              kg
            </ThemedText>
            <ThemedText style={dataTableStyles.cell}>
              {record.cjRecord}
              kg
            </ThemedText>
            <ThemedText style={dataTableStyles.cell}>
              {record.totalRecord}
              kg
            </ThemedText>
          </View>
        )}
      />

      <GenericFilterModal
        {...filterModalProps}
        sections={buildFilterSections}
        onResetFilters={handleResetFilters}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
