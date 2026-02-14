import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { FilterSection, GenericFilterModal } from "@/components/ui/filters";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useAppColors } from "@/hooks/useAppColors";
import {
  fetchIntlRankings,
  IntlRanking,
} from "@/lib/database/fetchIntlRankings";
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

interface Filters {
  meet: string;
  age_category: string;
  gender: string;
}

// Number of rows to load initially
const PAGE_SIZE = 30;

const AGE_CATEGORY_ORDER = [
  "u11",
  "u13",
  "u15",
  "u17",
  "youth",
  "junior",
  "university",
  "u23",
  "u25",
  "senior",
];

function sortAgeCategories(ageCategories: string[]): string[] {
  return [...ageCategories].sort((a, b) => {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    const aIdx = AGE_CATEGORY_ORDER.indexOf(aLower);
    const bIdx = AGE_CATEGORY_ORDER.indexOf(bLower);

    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;

    const mastersA = aLower.startsWith("masters");
    const mastersB = bLower.startsWith("masters");

    if (mastersA && mastersB) {
      const numA = parseInt(aLower.replace(/[^0-9]/g, ""), 10);
      const numB = parseInt(bLower.replace(/[^0-9]/g, ""), 10);
      if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
        return numA - numB;
      }
      return a.localeCompare(b, undefined, { sensitivity: "base" });
    }
    if (mastersA) return 1;
    if (mastersB) return -1;

    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
}

export default function RecordsScreen() {
  const colors = useAppColors();
  const { isSubscribed, isLoading: isSubscriptionLoading } = useSubscription();
  const [filters, setFilters] = useState<Filters>({
    meet: "",
    age_category: "",
    gender: "",
  });
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [tempFilters, setTempFilters] = useState<Filters>(filters);

  const [intlRankings, setIntlRankings] = useState<IntlRanking[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [backgroundLoading, setBackgroundLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError(null);

    fetchIntlRankings()
      .then((data) => {
        if (cancelled) return;
        setIntlRankings(data.slice(0, PAGE_SIZE));
        setLoading(false);
        // If more data, load the rest in background
        if (data.length > PAGE_SIZE) {
          setBackgroundLoading(true);
          setTimeout(() => {
            if (cancelled) return;
            setIntlRankings(data);
            setBackgroundLoading(false);
          }, 0);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchError(err.message || "Failed to fetch rankings");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Only set default filters the first time rankings are loaded
  const [hasSetDefaultFilters, setHasSetDefaultFilters] = useState(false);
  useEffect(() => {
    if (!hasSetDefaultFilters && intlRankings.length > 0) {
      setFilters((prev) => ({
        meet:
          typeof intlRankings[0].meet === "string" ? intlRankings[0].meet : "",
        age_category: "Senior",
        gender: "Men",
      }));
      setTempFilters((prev) => ({
        meet:
          typeof intlRankings[0].meet === "string" ? intlRankings[0].meet : "",
        age_category: "Senior",
        gender: "Men",
      }));
      setHasSetDefaultFilters(true);
    }
    // Only set once, when data first arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intlRankings.length, hasSetDefaultFilters]);

  // Dynamically build filter options from the fetched data
  const meetOptions = useMemo(
    () =>
      Array.from(
        new Set(
          intlRankings.map((r) => (typeof r.meet === "string" ? r.meet : "")),
        ),
      )
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    [intlRankings],
  );

  // Filter age category options based on the selected meet in tempFilters
  const ageCategoryOptions = useMemo(() => {
    const filteredData = tempFilters.meet
      ? intlRankings.filter((r) => r.meet === tempFilters.meet)
      : intlRankings;

    return sortAgeCategories(
      Array.from(
        new Set(
          filteredData.map((r) =>
            typeof r.age_category === "string" ? r.age_category : "",
          ),
        ),
      ).filter(Boolean),
    );
  }, [intlRankings, tempFilters.meet]);

  const genderOptions = useMemo(
    () =>
      Array.from(
        new Set(
          intlRankings.map((r) =>
            typeof r.gender === "string" ? r.gender : "",
          ),
        ),
      )
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    [intlRankings],
  );

  // Filter intlRankings based on selected filters and sort by rank
  const filteredRankings = useMemo(() => {
    return intlRankings
      .filter(
        (r) =>
          (!filters.meet || r.meet === filters.meet) &&
          (!filters.age_category || r.age_category === filters.age_category) &&
          (!filters.gender || r.gender === filters.gender),
      )
      .sort((a, b) => {
        // Handle cases where ranking might be null/undefined
        const rankA = a.ranking ?? Number.MAX_SAFE_INTEGER;
        const rankB = b.ranking ?? Number.MAX_SAFE_INTEGER;
        return rankA - rankB;
      });
  }, [intlRankings, filters]);

  const getFilterDisplayText = () => {
    const meet = filters.meet;
    const age_category = filters.age_category;
    const gender = filters.gender;
    return `${meet} • ${age_category} • ${gender}`;
  };

  const handleApplyFilters = () => {
    setFilters(tempFilters);
    setShowFilterModal(false);
  };

  const handleResetFilters = () => {
    const defaultMeet =
      meetOptions[0] ||
      (typeof intlRankings[0]?.meet === "string" ? intlRankings[0].meet : "");
    const defaultAgeCategory = ageCategoryOptions.includes("Senior")
      ? "Senior"
      : ageCategoryOptions[0] || "";
    const defaultGender = genderOptions.includes("Men")
      ? "Men"
      : genderOptions[0] || "";

    const resetFilters: Filters = {
      meet: defaultMeet,
      age_category: defaultAgeCategory,
      gender: defaultGender,
    };
    setFilters(resetFilters);
    setTempFilters(resetFilters);
  };

  const filterSections: FilterSection[] = [
    {
      id: "meet",
      title: "Meet",
      options: meetOptions.map((meet) => ({
        value: meet,
        label: meet,
      })),
    },
    {
      id: "age_category",
      title: "Age Category",
      options: ageCategoryOptions.map((age) => ({
        value: age,
        label: age,
      })),
    },
    {
      id: "gender",
      title: "Gender",
      options: genderOptions.map((gender) => ({
        value: gender,
        label: gender,
      })),
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
          title: `International Rankings`,
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

      {/* --- TABLE SECTION START --- */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        <View>
          {/* Apply minWidth to the container View */}
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            {/* Header Row */}
            <View
              style={[styles.headerRow, { borderBottomColor: colors.border }]}
            >
              <ThemedText style={[styles.headerCell, { width: "50%" }]}>
                Name
              </ThemedText>
              <ThemedText style={[styles.headerCell, { width: "25%" }]}>
                Total
              </ThemedText>
              <ThemedText style={[styles.headerCell, { width: "25%" }]}>
                % of A
              </ThemedText>
            </View>

            {/* Loading/Error/Empty/Data States (single ternary for exclusivity) */}
            {loading ? (
              <ThemedText style={styles.statusText}>Loading...</ThemedText>
            ) : fetchError ? (
              <ThemedText style={[styles.statusText, { color: "red" }]}>
                {fetchError}
              </ThemedText>
            ) : !loading &&
              filteredRankings.length === 0 &&
              intlRankings.length > 0 ? (
              <ThemedText
                style={[styles.statusText, { color: colors.secondaryText }]}
              >
                No rankings available.
              </ThemedText>
            ) : (
              <>
                {filteredRankings.map((ranking: IntlRanking, index: number) => (
                  <View
                    key={index}
                    style={[
                      styles.row,
                      index < filteredRankings.length - 1 && {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: colors.border,
                      },
                    ]}
                  >
                    <ThemedText style={[styles.cell, { width: "50%" }]}>
                      {ranking.name ?? ""}
                    </ThemedText>
                    <ThemedText style={[styles.cell, { width: "25%" }]}>
                      {ranking.total ?? ""}
                    </ThemedText>
                    <ThemedText style={[styles.cell, { width: "25%" }]}>
                      {typeof ranking.percent_a === "number"
                        ? `${ranking.percent_a.toFixed(2)}%`
                        : ""}
                    </ThemedText>
                  </View>
                ))}
                {backgroundLoading && filteredRankings.length > 0 && (
                  <ThemedText
                    style={[
                      styles.statusText,
                      { marginTop: 8, color: colors.secondaryText },
                    ]}
                  >
                    Loading more results...
                  </ThemedText>
                )}
              </>
            )}
          </View>
        </View>
      </ScrollView>
      {/* --- TABLE SECTION END --- */}

      <GenericFilterModal
        visible={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        sections={filterSections}
        filters={{
          meet: tempFilters.meet,
          age_category: tempFilters.age_category,
          gender: tempFilters.gender,
        }}
        onApplyFilters={(newFilters) => {
          const updatedFilters = {
            meet: newFilters.meet,
            age_category: newFilters.age_category,
            gender: newFilters.gender,
          };
          setFilters(updatedFilters);
          setTempFilters(updatedFilters);
          setShowFilterModal(false);
        }}
        onResetFilters={handleResetFilters}
        resultCount={filteredRankings.length}
        resultLabel="rankings"
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
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
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
    paddingVertical: 16, // Keep vertical padding
    paddingHorizontal: 0, // Remove horizontal padding here, apply to card/rows if needed
    alignItems: "flex-start", // Align the horizontal scrollview container to the start
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
    marginHorizontal: 16, // Add horizontal margin to the card itself
    // minWidth is set dynamically inline
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    // No paddingHorizontal here, width is controlled by cells
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(60, 60, 67, 0.03)",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    // No paddingHorizontal here, width is controlled by cells
    paddingVertical: 12,
  },
  headerCell: {
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center", // Center text within the cell
    paddingHorizontal: 4, // Add small horizontal padding within cells if needed
    // width is applied inline
  },
  cell: {
    fontSize: 17,
    textAlign: "center", // Center text within the cell
    paddingHorizontal: 4, // Add small horizontal padding within cells if needed
    // width is applied inline
  },
  statusText: {
    textAlign: "center",
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 16, // Add padding to status text as it's outside the row structure
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    padding: 16,
  },
  modalContent: {
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
});
