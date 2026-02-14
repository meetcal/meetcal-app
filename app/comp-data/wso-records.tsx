import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { FilterSection, GenericFilterModal } from "@/components/ui/filters";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useAppColors } from "@/hooks/useAppColors";
import {
  fetchWSOList,
  fetchWSORecords,
} from "@/lib/database/fetch-wso-records";
import {
  AgeGroupRecords,
  RecordsData,
  WeightClassRecord,
} from "@/types/records";
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

type Gender = "Men" | "Women";

interface Filters {
  wso: string;
  gender: Gender;
  ageGroup: string;
}

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

export default function RecordsScreen() {
  const colors = useAppColors();
  const [availableWSOs, setAvailableWSOs] = useState<string[]>([]);
  const [availableAgeGroups, setAvailableAgeGroups] = useState<string[]>([]);
  const { isSubscribed, isLoading: isSubscriptionLoading } = useSubscription();

  const [filters, setFilters] = useState<Filters>({
    wso: "",
    gender: "Men",
    ageGroup: "Senior",
  });
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [tempFilters, setTempFilters] = useState<Filters>(filters);

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
      }
    }
    fetchWSOs();
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
  }, [filters.wso]);

  const recordsData = useMemo<RecordsData | null>(() => {
    return records || null;
  }, [records]);

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
    const resetFilters = { wso: "", gender: "Men" as Gender, ageGroup: "" };
    setFilters(resetFilters);
    setTempFilters(resetFilters);
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
              setTempFilters(filters);
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
          {fetchError && !loading && (
            <ThemedText style={styles.errorText}>{fetchError}</ThemedText>
          )}
          {!loading &&
            !fetchError &&
            (!recordsData ||
              !recordsData[filters.ageGroup as keyof RecordsData] ||
              recordsData[filters.ageGroup as keyof RecordsData]?.[
                filters.gender as keyof AgeGroupRecords
              ]?.length === 0) && (
              <ThemedText
                style={{
                  textAlign: "center",
                  marginTop: 16,
                  color: colors.secondaryText,
                }}
              >
                No {filters.wso} records available for {filters.gender} in the{" "}
                {getAgeGroupDisplayText(filters.ageGroup)} age group.
              </ThemedText>
            )}
          {!loading &&
            !fetchError &&
            recordsData &&
            recordsData[filters.ageGroup as keyof RecordsData]?.[
              filters.gender as keyof AgeGroupRecords
            ]?.length > 0 &&
            recordsData[filters.ageGroup as keyof RecordsData]?.[
              filters.gender as keyof AgeGroupRecords
            ]?.map((record: WeightClassRecord, index: number) => (
              <View
                key={`${filters.wso}-${filters.ageGroup}-${filters.gender}-${record.weightClass}`}
                style={[
                  styles.row,
                  index <
                    (recordsData[filters.ageGroup as keyof RecordsData]?.[
                      filters.gender as keyof AgeGroupRecords
                    ]?.length ?? 0) -
                      1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <ThemedText style={[styles.cell, { flex: 2 }]}>
                  {record.weightClass}
                  kg
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
            ))}
        </View>
      </ScrollView>

      <GenericFilterModal
        visible={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        sections={filterSections}
        filters={{
          wso: tempFilters.wso,
          gender: tempFilters.gender,
          ageGroup: tempFilters.ageGroup,
        }}
        onApplyFilters={(newFilters) => {
          const updatedFilters = {
            wso: newFilters.wso,
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
