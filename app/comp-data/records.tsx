import { DataTable, dataTableStyles } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { SubscriptionGate } from "@/components/ui/SubscriptionGate";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { FilterSection, GenericFilterModal } from "@/components/ui/filters";
import { useAppColors } from "@/hooks/useAppColors";
import { useFilterState } from "@/hooks/useFilterState";
import {
  fetchAgeGroups,
  fetchFederations,
  fetchRecords,
} from "@/lib/database/fetch-records";
import { sortAgeGroups } from "@/lib/sortAgeGroups";
import { AgeGroup, Filters, Gender, RecordsData, WeightClassRecord } from "@/types/records";
import { Stack } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

// Helper to create an empty RecordsData structure - this might need refinement
// For now, an empty object will be used as RecordsData can have dynamic keys
const EMPTY_RECORDS_DATA: RecordsData = {} as RecordsData;

export default function RecordsScreen() {
  const colors = useAppColors();
  const [availableFederations, setAvailableFederations] = useState<string[]>(
    [],
  );
  const [ageGroupsCache, setAgeGroupsCache] = useState<
    Record<string, string[]>
  >({});
  const modalDraftFederationRef = React.useRef<string>("");

  const {
    filters,
    setFilters,
    setTempFilters,
    showFilterModal,
    openFilters,
    filterModalProps,
  } = useFilterState<Filters>({
    defaultFilters: { federation: "", gender: "Men", ageGroup: "" },
  });

  const [records, setRecords] = useState<RecordsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [allRecords, setAllRecords] = useState<RecordsData | null>(null);

  // Effect for initial federation and age group loading
  useEffect(() => {
    async function loadInitialFilters() {
      setLoading(true);
      let determinedFederation = "";
      let determinedAgeGroup = "Senior";
      const defaultGender = "Men";

      try {
        const fetchedFederations = await fetchFederations();
        const filteredFederations = fetchedFederations.filter(
          (federation) => federation.toUpperCase() !== "BWL",
        );
        setAvailableFederations(filteredFederations);

        const preferredFederation = "USAW";
        const preferredAgeGroup = "Senior";

        if (filteredFederations.length > 0) {
          if (filteredFederations.includes(preferredFederation)) {
            determinedFederation = preferredFederation;
            determinedAgeGroup = preferredAgeGroup;
          } else {
            determinedFederation = filteredFederations[0];
            determinedAgeGroup = preferredAgeGroup;
          }
        } else {
          setFetchError("No federations found.");
          determinedAgeGroup = "";
        }

        setFilters({
          federation: determinedFederation,
          gender: defaultGender,
          ageGroup: determinedAgeGroup,
        });
        setTempFilters({
          federation: determinedFederation,
          gender: defaultGender,
          ageGroup: determinedAgeGroup,
        });
        // If modal were to open immediately, ensure its age groups are for determinedFederation
        // This is handled by the modal opening effect logic now, by checking against modalFederationForAgeGroups
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : "Failed to fetch initial filter data";
        setFetchError(errorMessage);
        // Set empty filters on error to prevent crashes, records effect will handle loading false
        setFilters({ federation: "", gender: defaultGender, ageGroup: "" });
        setTempFilters({ federation: "", gender: defaultGender, ageGroup: "" });
      } finally {
        // setLoading(false); // Loading is primarily for the records fetch, not initial filter setup.
        // The records fetch effect will set loading true/false.
      }
    }
    loadInitialFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch age groups when modal opens for the current federation
  React.useEffect(() => {
    if (
      showFilterModal &&
      filters.federation &&
      !ageGroupsCache[filters.federation]
    ) {
      fetchAgeGroups(filters.federation)
        .then((fetchedAgeGroups) => {
          setAgeGroupsCache((prev) => ({
            ...prev,
            [filters.federation]: fetchedAgeGroups,
          }));
        })
        .catch((err) => {
          console.error(
            `Failed to fetch age groups for ${filters.federation}`,
            err,
          );
        });
    }
  }, [showFilterModal, filters.federation, ageGroupsCache]);

  // Fetch age groups for a federation (used by buildFilterSections)
  const fetchAgeGroupsForFederation = React.useCallback(
    (federation: string) => {
      if (!federation || ageGroupsCache[federation]) {
        return; // Already cached or no federation
      }

      fetchAgeGroups(federation)
        .then((fetchedAgeGroups) => {
          setAgeGroupsCache((prev) => ({
            ...prev,
            [federation]: fetchedAgeGroups,
          }));
        })
        .catch((err) => {
          console.error(`Failed to fetch age groups for ${federation}`, err);
        });
    },
    [ageGroupsCache],
  );

  // Fetch full federation records once per federation selection.
  useEffect(() => {
    if (!filters.federation) {
      setLoading(false);
      setRecords(null);
      setAllRecords(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFetchError(null);

    fetchRecords(filters.federation)
      .then((data) => {
        if (!cancelled) {
          const nextAgeGroups = Object.keys(data);

          // Cache age groups for this federation
          setAgeGroupsCache((prev) => ({
            ...prev,
            [filters.federation]: nextAgeGroups,
          }));

          setAllRecords(data);
          setRecords(data);

          if (
            nextAgeGroups.length > 0 &&
            !nextAgeGroups.includes(filters.ageGroup)
          ) {
            setFilters((prev) => ({ ...prev, ageGroup: nextAgeGroups[0] }));
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchError(err.message || "Failed to fetch records");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.federation]);

  const recordsData = useMemo(() => {
    return allRecords || records || EMPTY_RECORDS_DATA;
  }, [allRecords, records]);

  const displayAgeGroup = useMemo(() => {
    const ageGroupsForFederation = ageGroupsCache[filters.federation] || [];

    if (!filters.ageGroup && ageGroupsForFederation.length > 0) {
      return ageGroupsForFederation[0];
    }
    if (ageGroupsForFederation.includes(filters.ageGroup)) {
      return filters.ageGroup;
    }
    // Fallback if filters.ageGroup is somehow invalid and list has items
    if (ageGroupsForFederation.length > 0) {
      return ageGroupsForFederation[0];
    }
    return filters.ageGroup || ""; // Default to current or empty if list is empty
  }, [filters.ageGroup, filters.federation, ageGroupsCache]);

  const currentRecords = useMemo<WeightClassRecord[]>(() => {
    return recordsData[displayAgeGroup]?.[filters.gender] ?? [];
  }, [recordsData, displayAgeGroup, filters.gender]);

  const getAgeGroupDisplayText = (ageGroup: AgeGroup | undefined) => {
    if (!ageGroup) return "";
    // Simple display: capitalize first letter if not a 'u' category like 'u13'
    if (
      ageGroup.startsWith("u") &&
      ageGroup.length > 1 &&
      !isNaN(Number(ageGroup.substring(1, 3)))
    ) {
      return ageGroup.toUpperCase(); // e.g. U13, U15
    }
    return ageGroup.charAt(0).toUpperCase() + ageGroup.slice(1);
  };

  const getFilterDisplayText = () => {
    const fed = filters.federation || "N/A";
    const gen = filters.gender === "Men" ? "Men" : "Women";
    const age = getAgeGroupDisplayText(displayAgeGroup) || "N/A";
    return `${fed} • ${gen} • ${age}`;
  };

  const handleResetFilters = () => {
    const reset = {
      federation: "",
      gender: "Men" as Gender,
      ageGroup: "",
    };
    setFilters(reset);
    setTempFilters(reset);
  };

  // Build filter sections dynamically based on modal's internal tempFilters
  const buildFilterSections = React.useCallback(
    (modalTempFilters: Record<string, string>): FilterSection[] => {
      const selectedFederation =
        modalTempFilters.federation || filters.federation || "";

      // Trigger fetch if needed (won't cause re-render since it checks cache first)
      if (
        selectedFederation &&
        selectedFederation !== modalDraftFederationRef.current
      ) {
        modalDraftFederationRef.current = selectedFederation;
        fetchAgeGroupsForFederation(selectedFederation);
      }

      const ageGroupsForFederation = selectedFederation
        ? ageGroupsCache[selectedFederation] || []
        : [];

      return [
        {
          id: "federation",
          title: "Federation",
          options: availableFederations.map((fed) => ({
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
          options: sortAgeGroups(ageGroupsForFederation).map((ag) => ({
            value: ag,
            label: getAgeGroupDisplayText(ag),
          })),
          dependsOn: ["federation"],
        },
      ];
    },
    [
      availableFederations,
      ageGroupsCache,
      fetchAgeGroupsForFederation,
      filters.federation,
    ],
  );

  return (
    <SubscriptionGate>
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
    </SubscriptionGate>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
