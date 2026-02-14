import { DataTable, dataTableStyles } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { SubscriptionGate } from "@/components/ui/SubscriptionGate";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { FilterSection, GenericFilterModal } from "@/components/ui/filters";
import { useAppColors } from "@/hooks/useAppColors";
import { useFilterState } from "@/hooks/useFilterState";
import {
  fetchWSOList,
  fetchWSORecords,
} from "@/lib/database/fetch-wso-records";
import { sortAgeGroups } from "@/lib/sortAgeGroups";
import {
  AgeGroupRecords,
  RecordsData,
  WeightClassRecord,
} from "@/types/records";
import { Stack } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

type Gender = "Men" | "Women";

interface Filters {
  wso: string;
  gender: Gender;
  ageGroup: string;
}

export default function RecordsScreen() {
  const colors = useAppColors();
  const [availableWSOs, setAvailableWSOs] = useState<string[]>([]);
  const [availableAgeGroups, setAvailableAgeGroups] = useState<string[]>([]);

  const {
    filters,
    setFilters,
    setTempFilters,
    openFilters,
    filterModalProps,
  } = useFilterState<Filters>({
    defaultFilters: { wso: "", gender: "Men", ageGroup: "Senior" },
  });

  const [records, setRecords] = useState<RecordsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchWSOs() {
      try {
        const wsos = await fetchWSOList();
        setAvailableWSOs(wsos);
        if (wsos.length > 0) {
          setFilters((f) => ({ ...f, wso: wsos[0] }));
          setTempFilters((f) => ({ ...f, wso: wsos[0] }));
        }
      } catch {
        setFetchError("Failed to load WSOs");
      } finally {
        setLoading(false);
      }
    }
    fetchWSOs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!filters.wso) {
      setLoading(false);
      setRecords(null);
      setAvailableAgeGroups([]);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    setRecords(null);
    setFetchError(null);

    fetchWSORecords(filters.wso)
      .then((data) => {
        if (!cancelled) {
          const ageGroups = sortAgeGroups(Object.keys(data));
          setAvailableAgeGroups(ageGroups);

          const fallbackAgeGroup = ageGroups[0] ?? "";
          setFilters((prev) => {
            if (!fallbackAgeGroup || ageGroups.includes(prev.ageGroup))
              return prev;
            return { ...prev, ageGroup: fallbackAgeGroup };
          });
          setTempFilters((prev) => {
            if (!fallbackAgeGroup || ageGroups.includes(prev.ageGroup))
              return prev;
            return { ...prev, ageGroup: fallbackAgeGroup };
          });
          setRecords(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchError(err.message || "Failed to fetch records");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.wso]);

  const recordsData = useMemo<RecordsData | null>(() => {
    return records || null;
  }, [records]);

  const currentRecords = useMemo<WeightClassRecord[]>(() => {
    if (!recordsData) return [];
    return (
      recordsData[filters.ageGroup as keyof RecordsData]?.[
        filters.gender as keyof AgeGroupRecords
      ] ?? []
    );
  }, [recordsData, filters.ageGroup, filters.gender]);

  const getAgeGroupDisplayText = (ageGroup: string) => {
    if (!ageGroup) return "";
    switch (ageGroup) {
      case "u13":
        return "U13";
      case "u15":
        return "U15";
      case "u17":
        return "U17";
      default:
        return ageGroup.charAt(0).toUpperCase() + ageGroup.slice(1);
    }
  };

  const getFilterDisplayText = () => {
    const wso = filters.wso;
    const gen = filters.gender;
    const age = getAgeGroupDisplayText(filters.ageGroup);
    return `${wso} • ${gen} • ${age}`;
  };

  const handleResetFilters = () => {
    const reset = { wso: "", gender: "Men" as Gender, ageGroup: "Senior" };
    setFilters(reset);
    setTempFilters(reset);
  };

  const genderOptions = (["Men", "Women"] as Gender[]).sort((a, b) =>
    a.localeCompare(b),
  );

  // Build filter sections for GenericFilterModal
  const sortedAgeGroups = sortAgeGroups(availableAgeGroups);
  const filterSections: FilterSection[] = [
    {
      id: "wso",
      title: "WSO",
      options: availableWSOs.map((wso: string) => ({ value: wso, label: wso })),
      allOptionLabel: "Select WSO",
    },
    {
      id: "gender",
      title: "Gender",
      options: genderOptions.map((g) => ({ value: g, label: g })),
    },
    {
      id: "ageGroup",
      title: "Age Group",
      options: sortedAgeGroups.map((ag: string) => ({
        value: ag,
        label: getAgeGroupDisplayText(ag),
      })),
      allOptionLabel: "All Age Groups",
    },
  ];

  return (
    <SubscriptionGate>
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Stack.Screen
        options={{
          title: `WSO Records`,
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
          { label: "Snatch" },
          { label: "C&J" },
          { label: "Total" },
        ]}
        data={currentRecords}
        keyExtractor={(record) =>
          `${filters.wso}-${filters.ageGroup}-${filters.gender}-${record.weightClass}`
        }
        loading={loading}
        error={fetchError}
        emptyMessage={`No ${filters.wso} records available for ${filters.gender} in the ${getAgeGroupDisplayText(filters.ageGroup)} age group.`}
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
              kg
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
        sections={filterSections}
        onResetFilters={handleResetFilters}
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
