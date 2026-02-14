import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { FilterSection, GenericFilterModal } from "@/components/ui/filters";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useAppColors } from "@/hooks/useAppColors";
import {
  fetchAgeGroups,
  fetchFederations,
  fetchRecords,
} from "@/lib/database/fetch-records";
import { RecordsData, WeightClassRecord } from "@/types/records";
import { Stack } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import PaywallScreen from "../shared-screens/paywall";

type Federation = string;
type Gender = "Men" | "Women";
type AgeGroup = string; // Changed from specific union

// Helper to create an empty RecordsData structure - this might need refinement
// For now, an empty object will be used as RecordsData can have dynamic keys
const EMPTY_RECORDS_DATA: RecordsData = {} as RecordsData;

const AGE_GROUP_ORDER = [
  "u11",
  "u13",
  "u15",
  "u17",
  "youth",
  "junior",
  "senior",
];

function sortAgeGroups(ageGroups: string[]): string[] {
  return [...ageGroups].sort((a, b) => {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    const aIdx = AGE_GROUP_ORDER.indexOf(aLower);
    const bIdx = AGE_GROUP_ORDER.indexOf(bLower);

    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;

    const mastersA = aLower.startsWith("masters");
    const mastersB = bLower.startsWith("masters");
    if (mastersA && mastersB) {
      const numA = parseInt(aLower.replace(/[^0-9]/g, ""), 10);
      const numB = parseInt(bLower.replace(/[^0-9]/g, ""), 10);
      return numA - numB;
    }
    if (mastersA) return 1;
    if (mastersB) return -1;
    return a.localeCompare(b);
  });
}

interface Filters {
  federation: Federation;
  gender: Gender;
  ageGroup: AgeGroup;
}

export default function RecordsScreen() {
  const colors = useAppColors();
  const { isSubscribed, isLoading: isSubscriptionLoading } = useSubscription();
  const [availableFederations, setAvailableFederations] = useState<string[]>(
    [],
  );
  const [ageGroupsCache, setAgeGroupsCache] = useState<
    Record<string, string[]>
  >({});
  const modalDraftFederationRef = React.useRef<string>("");

  const [filters, setFilters] = useState<Filters>({
    federation: "",
    gender: "Men",
    ageGroup: "",
  });
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [tempFilters, setTempFilters] = useState<Filters>(filters);

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

  const getAgeGroupDisplayText = (ageGroup: AgeGroup | undefined) => {
    if (!ageGroup) return "";
    // Simple display: capitalize first letter if not a 'u' category like 'u13'
    if (
      ageGroup.startsWith("u") &&
      ageGroup.length > 1 &&
      !isNaN(Number(ageGroup.substring(1, 3)))
    ) {
      return ageGroup.toUpperCase().replace("U", "U"); // e.g. U13, U15
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
    const resetFilters = {
      federation: "",
      gender: "Men" as Gender,
      ageGroup: "",
    };
    setFilters(resetFilters);
    setTempFilters(resetFilters);
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

  if (isSubscriptionLoading) {
    return (
      <ThemedView
        style={[
          styles.container,
          {
            backgroundColor: colors.background,
            justifyContent: "center",
            alignItems: "center",
          },
        ]}
      >
        <ActivityIndicator size="large" color={colors.link} />
      </ThemedView>
    );
  }

  if (!isSubscribed) {
    return <PaywallScreen />;
  }

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
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
        }}
      />

      <View
        style={[
          styles.filterContainer,
          {
            backgroundColor: colors.background,
            borderBottomColor: colors.borderBottom,
            borderBottomWidth: 1,
          },
        ]}
      >
        <View style={styles.filterButtons}>
          <Pressable
            style={({ pressed }) => [
              styles.filterButton,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={() => {
              // tempFilters will be synced by useEffect [showFilterModal]
              setShowFilterModal(true);
            }}
          >
            <ThemedText
              style={[styles.filterButtonText, { color: colors.secondaryText }]}
            >
              {getFilterDisplayText()}
            </ThemedText>
            <IconSymbol
              name="chevron.down"
              size={12}
              color={colors.secondaryText}
            />
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View
            style={[styles.headerRow, { borderBottomColor: colors.border }]}
          >
            <ThemedText style={[styles.headerCell, { flex: 2 }]}>
              Weight Class
            </ThemedText>
            <ThemedText style={styles.headerCell}>Snatch</ThemedText>
            <ThemedText style={styles.headerCell}>C&J</ThemedText>
            <ThemedText style={styles.headerCell}>Total</ThemedText>
          </View>

          {loading && (
            <ThemedText style={styles.loadingText}>Loading...</ThemedText>
          )}
          {fetchError && (
            <ThemedText style={styles.errorText}>{fetchError}</ThemedText>
          )}
          {!loading &&
            !fetchError &&
            (!recordsData[displayAgeGroup] ||
              recordsData[displayAgeGroup]?.[filters.gender]?.length === 0) && (
              <ThemedText
                style={{
                  textAlign: "center",
                  marginTop: 16,
                  color: colors.secondaryText,
                }}
              >
                No {filters.federation} records available for{" "}
                {filters.gender === "Men" ? "men" : "women"}
                in the {getAgeGroupDisplayText(displayAgeGroup) ||
                  "selected"}{" "}
                age group.
              </ThemedText>
            )}
          {!loading &&
            !fetchError &&
            recordsData[displayAgeGroup]?.[filters.gender]?.length > 0 &&
            recordsData[displayAgeGroup][filters.gender].map(
              (record: WeightClassRecord, index: number) => (
                <View
                  key={`${filters.federation}-${displayAgeGroup}-${filters.gender}-${record.weightClass}-${index}`} // Added index for more unique key
                  style={[
                    styles.row,
                    index <
                      recordsData[displayAgeGroup][filters.gender].length -
                        1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.border,
                    },
                  ]}
                >
                  <ThemedText style={[styles.cell, { flex: 2 }]}>
                    {record.weightClass}
                  </ThemedText>
                  <ThemedText style={styles.cell}>
                    {record.snatchRecord}
                    kg
                  </ThemedText>
                  <ThemedText style={styles.cell}>
                    {record.cjRecord}
                    kg
                  </ThemedText>
                  <ThemedText style={styles.cell}>
                    {record.totalRecord}
                    kg
                  </ThemedText>
                </View>
              ),
            )}
        </View>
      </ScrollView>

      <GenericFilterModal
        visible={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        sections={buildFilterSections}
        filters={{
          federation: tempFilters.federation,
          gender: tempFilters.gender,
          ageGroup: tempFilters.ageGroup,
        }}
        onApplyFilters={(newFilters) => {
          const updatedFilters = {
            federation: newFilters.federation,
            gender: newFilters.gender as Gender,
            ageGroup: newFilters.ageGroup,
          };
          setFilters(updatedFilters);
          setTempFilters(updatedFilters);
          setShowFilterModal(false);
        }}
        onResetFilters={handleResetFilters}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  filterContainer: {
    padding: 16,
    backgroundColor: "#F5F5F5",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#C6C6C8",
  },
  filterButtons: {
    flexDirection: "row",
    gap: 8,
  },
  filterButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#C6C6C8",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    elevation: 1,
  },
  filterButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  card: {
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  headerRow: {
    flexDirection: "row",
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(60, 60, 67, 0.03)",
  },
  headerCell: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
    padding: 16,
  },
  cell: {
    flex: 1,
    fontSize: 17,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 16,
  },
  modalContent: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    overflow: "hidden",
    marginHorizontal: 24,
    maxHeight: "80%",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  modalScrollContent: {
    flexGrow: 0,
  },
  filterSection: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterSectionButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  filterSectionButtonContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  filterSectionLabel: {
    fontSize: 13,
    marginBottom: 2,
  },
  filterSectionValue: {
    fontSize: 17,
    fontWeight: "400",
  },
  filterOptions: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  filterOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterOptionText: {
    fontSize: 17,
  },
  modalFooter: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  applyButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 30,
    paddingVertical: 10,
    borderRadius: 8,
    width: "100%",
    alignItems: "center",
  },
  applyButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
  errorText: {
    color: "red",
    textAlign: "center",
    marginTop: 16,
  },
  loadingText: {
    textAlign: "center",
    marginTop: 16,
  },
});
