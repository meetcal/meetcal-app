import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { FilterSection, GenericFilterModal } from "@/components/ui/filters";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useAppColors } from "@/hooks/useAppColors";
import { fetchStandards } from "@/lib/database/fetch-standards";
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

type Gender = "men" | "women";
type AgeGroup = "senior" | "junior" | "youth" | "u15";

interface Filters {
  gender: Gender;
  ageGroup: AgeGroup;
}

interface StandardsData {
  [ageGroup: string]: {
    [gender: string]: {
      weightClass: string;
      a: number;
      b: number;
    }[];
  };
}

export default function NewStandardsScreen() {
  const colors = useAppColors();
  const { isSubscribed, isLoading: isSubscriptionLoading } = useSubscription();
  const [filters, setFilters] = useState<Filters>({
    gender: "men",
    ageGroup: "senior",
  });
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [tempFilters, setTempFilters] = useState<Filters>(filters);

  const [standards, setStandards] = useState<StandardsData | null>(null);
  const [allStandards, setAllStandards] = useState<StandardsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError(null);

    fetchStandards()
      .then((data) => {
        if (!cancelled) {
          setAllStandards(data);
          setStandards(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchError(err.message || "Failed to fetch standards");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const standardsData = useMemo(() => {
    const dataToUse = allStandards || standards || {};
    if (!dataToUse[filters.ageGroup]) return [];
    if (!dataToUse[filters.ageGroup][filters.gender]) return [];
    return dataToUse[filters.ageGroup][filters.gender];
  }, [allStandards, standards, filters.ageGroup, filters.gender]);

  const getFilterDisplayText = () => {
    const genderText = filters.gender === "men" ? "Men" : "Women";
    const ageGroupText =
      filters.ageGroup === "u15"
        ? "U15"
        : filters.ageGroup.charAt(0).toUpperCase() + filters.ageGroup.slice(1);
    return `${genderText} • ${ageGroupText}`;
  };

  const handleApplyFilters = () => {
    setFilters(tempFilters);
    setShowFilterModal(false);
  };

  const handleResetFilters = () => {
    const resetFilters: Filters = {
      gender: "men",
      ageGroup: "senior",
    };
    setFilters(resetFilters);
    setTempFilters(resetFilters);
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
      allOptionLabel: "All Genders",
    },
    {
      id: "ageGroup",
      title: "Age Group",
      options: ageGroupOptions.map((a) => ({ value: a.id, label: a.label })),
      allOptionLabel: "All Ages",
    },
  ];

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
            <ThemedText style={styles.headerCell}>A</ThemedText>
            <ThemedText style={styles.headerCell}>B</ThemedText>
          </View>

          {loading && (
            <ThemedText style={{ textAlign: "center", marginTop: 16 }}>
              Loading...
            </ThemedText>
          )}
          {fetchError && (
            <ThemedText
              style={{ color: "red", textAlign: "center", marginTop: 16 }}
            >
              {fetchError}
            </ThemedText>
          )}
          {standardsData && standardsData.length > 0
            ? standardsData.map((record, index) => (
                <View
                  key={record.weightClass}
                  style={[
                    styles.row,
                    index < standardsData.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.border,
                    },
                  ]}
                >
                  <ThemedText style={[styles.cell, { flex: 2 }]}>
                    {record.weightClass}
                  </ThemedText>
                  <ThemedText style={styles.cell}>
                    {record.a}
                    kg
                  </ThemedText>
                  <ThemedText style={styles.cell}>
                    {record.b}
                    kg
                  </ThemedText>
                </View>
              ))
            : !loading &&
              !fetchError && (
                <View
                  style={[
                    styles.row,
                    {
                      flex: 1,
                      justifyContent: "center",
                      alignItems: "center",
                      minHeight: 120,
                    },
                  ]}
                >
                  <ThemedText
                    style={[styles.cell, { flex: 1, textAlign: "center" }]}
                  >
                    No standards found for the selected filters.
                  </ThemedText>
                </View>
              )}
        </View>
      </ScrollView>

      <GenericFilterModal
        visible={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        sections={filterSections}
        filters={{
          gender: tempFilters.gender,
          ageGroup: tempFilters.ageGroup,
        }}
        onApplyFilters={(newFilters) => {
          const updatedFilters = {
            gender: newFilters.gender as Gender,
            ageGroup: newFilters.ageGroup as AgeGroup,
          };
          setFilters(updatedFilters);
          setTempFilters(updatedFilters);
          setShowFilterModal(false);
        }}
        onResetFilters={handleResetFilters}
        resultCount={standardsData.length}
        resultLabel="standards"
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
    borderBottomWidth: StyleSheet.hairlineWidth,
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
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
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
    borderRadius: 12,
    overflow: "hidden",
    marginHorizontal: 16,
    maxHeight: "80%",
  },
  modalScrollContent: {
    flexGrow: 0,
  },
  filterSection: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterSectionButton: {
    padding: 16,
  },
  filterSectionButtonContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  filterSectionLabel: {
    fontSize: 13,
    marginBottom: 4,
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
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterOptionText: {
    fontSize: 17,
  },
  modalFooter: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  applyButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 20,
    paddingVertical: 10,
    width: "100%",
    alignItems: "center",
    borderRadius: 8,
  },
  applyButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
});
