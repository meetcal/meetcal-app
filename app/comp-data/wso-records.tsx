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
  fetchWSOAgeGroups,
  wsoListResource,
  wsoRecordsResource,
} from "@/lib/database/fetch-wso-records";
import { formatAgeGroupLabel, sortAgeGroups } from "@/lib/sortAgeGroups";
import {
  AgeGroupRecords,
  RecordsData,
  WeightClassRecord,
} from "@/types/records";
import { Filters, Gender } from "@/types/wso-records";
import { Stack } from "expo-router";
import React, { useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";

const EMPTY_WSO_LIST: string[] = [];
const EMPTY_RECORDS_DATA: RecordsData = {} as RecordsData;

export default function WSORecordsScreen() {
  return (
    <SubscriptionGate>
      <WSORecordsScreenContent />
    </SubscriptionGate>
  );
}

function WSORecordsScreenContent() {
  const screenInsets = useScreenHorizontalInsets();
  const colors = useAppColors();
  const { currentTheme } = useTheme();
  const [ageGroupsCache, setAgeGroupsCache] = React.useState<
    Record<string, string[]>
  >({});
  const modalDraftWSORef = React.useRef("");

  const {
    filters,
    setFilters,
    setTempFilters,
    openFilters,
    filterModalProps,
  } = useFilterState<Filters>({
    defaultFilters: { wso: "", gender: "Men", ageGroup: "Senior" },
  });

  const {
    data: availableWSOs,
    isInitialLoading: isWSOLoading,
    error: wsoListError,
  } = useMutableResource({
    resource: wsoListResource,
    params: [] as const,
    initialData: EMPTY_WSO_LIST,
  });

  const wsoParams = useMemo<[string, string, Gender] | null>(
    () =>
      filters.wso
        ? [filters.wso, filters.ageGroup, filters.gender as Gender]
        : null,
    [filters.ageGroup, filters.gender, filters.wso],
  );
  const {
    data: records,
    isInitialLoading: isRecordsLoading,
    error: recordsError,
  } = useMutableResource({
    resource: wsoRecordsResource,
    params: wsoParams,
    initialData: EMPTY_RECORDS_DATA,
  });

  useEffect(() => {
    if (filters.wso || !availableWSOs.length) return;
    const nextWSO = availableWSOs[0];
    setFilters((prev) => ({ ...prev, wso: nextWSO }));
    setTempFilters((prev) => ({ ...prev, wso: nextWSO }));
  }, [availableWSOs, filters.wso, setFilters, setTempFilters]);

  const availableAgeGroups = useMemo(
    () => sortAgeGroups(Object.keys(records)),
    [records],
  );

  useEffect(() => {
    if (!filters.wso || availableAgeGroups.length === 0) return;

    setAgeGroupsCache((prev) => {
      const current = prev[filters.wso] ?? [];
      if (JSON.stringify(current) === JSON.stringify(availableAgeGroups)) {
        return prev;
      }
      return {
        ...prev,
        [filters.wso]: availableAgeGroups,
      };
    });
  }, [availableAgeGroups, filters.wso]);

  useEffect(() => {
    if (!availableAgeGroups.length) return;
    if (availableAgeGroups.includes(filters.ageGroup)) return;
    const nextAgeGroup = availableAgeGroups[0];
    setFilters((prev) => ({ ...prev, ageGroup: nextAgeGroup }));
    setTempFilters((prev) => ({ ...prev, ageGroup: nextAgeGroup }));
  }, [availableAgeGroups, filters.ageGroup, setFilters, setTempFilters]);

  const currentRecords = useMemo<WeightClassRecord[]>(() => {
    return (
      records[filters.ageGroup as keyof RecordsData]?.[
        filters.gender as keyof AgeGroupRecords
      ] ?? []
    );
  }, [records, filters.ageGroup, filters.gender]);

  const getFilterDisplayText = () => {
    const wso = filters.wso;
    const gen = filters.gender;
    const age = formatAgeGroupLabel(filters.ageGroup);
    return `${wso} • ${gen} • ${age}`;
  };

  const fetchAgeGroupsForWSO = React.useCallback(
    (wso: string) => {
      if (!wso || ageGroupsCache[wso]) return;

      fetchWSOAgeGroups(wso)
        .then((nextAgeGroups) => {
          setAgeGroupsCache((prev) => ({
            ...prev,
            [wso]: sortAgeGroups(nextAgeGroups),
          }));
        })
        .catch((error) => {
          console.error(`Failed to fetch age groups for ${wso}`, error);
        });
    },
    [ageGroupsCache],
  );

  const filterSections = React.useCallback(
    (modalTempFilters: Record<string, string>): FilterSection[] => {
      const selectedWSO = modalTempFilters.wso || filters.wso || "";

      if (
        selectedWSO &&
        selectedWSO !== filters.wso &&
        selectedWSO !== modalDraftWSORef.current
      ) {
        modalDraftWSORef.current = selectedWSO;
        fetchAgeGroupsForWSO(selectedWSO);
      }

      const modalAgeGroups =
        selectedWSO === filters.wso
          ? availableAgeGroups
          : ageGroupsCache[selectedWSO] ?? [];

      return [
        {
          id: "wso",
          title: "WSO",
          options: availableWSOs.map((wso: string) => ({ value: wso, label: wso })),
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
          options: modalAgeGroups.map((ageGroup: string) => ({
            value: ageGroup,
            label: formatAgeGroupLabel(ageGroup),
          })),
          dependsOn: ["wso"],
        },
      ];
    },
    [
      ageGroupsCache,
      availableAgeGroups,
      availableWSOs,
      fetchAgeGroupsForWSO,
      filters.wso,
    ],
  );

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }, screenInsets]}
    >
      <Stack.Screen
        options={{
          title: `WSO Records`,
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
        keyExtractor={(record) =>
          `${filters.wso}-${filters.ageGroup}-${filters.gender}-${record.weightClass}`
        }
        loading={isWSOLoading || (Boolean(filters.wso) && isRecordsLoading)}
        error={wsoListError || recordsError}
        emptyMessage={`No ${filters.wso} records available for ${filters.gender} in the ${formatAgeGroupLabel(filters.ageGroup)} age group.`}
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
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
