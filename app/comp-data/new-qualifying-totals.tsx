import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { FilterSection, GenericFilterModal } from "@/components/ui/filters";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useAppColors } from "@/hooks/useAppColors";
import {
  fetchQualifyingTotals,
  QualifyingTotalsData,
} from "@/lib/database/fetch-qualifying-totals";
import { Stack } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import PaywallScreen from "../shared-screens/paywall";

type Gender = "Men" | "Women";
type Event = string;
type AgeGroup = string;

interface Filters {
  event: Event;
  gender: Gender;
  ageGroup: AgeGroup;
}

export default function QualifyingTotalsScreen() {
  const colors = useAppColors();
  const { isSubscribed, isLoading: isSubscriptionLoading } = useSubscription();
  const [filters, setFilters] = useState<Filters>({
    event: "Nationals",
    gender: "Men",
    ageGroup: "Senior",
  });
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [tempFilters, setTempFilters] = useState<Filters>(filters);
  const [totals, setTotals] = useState<QualifyingTotalsData | null>(null);
  const [allTotals, setAllTotals] = useState<QualifyingTotalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError(null);

    fetchQualifyingTotals()
      .then((data) => {
        if (!cancelled) {
          setAllTotals(data);
          setTotals(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchError(err.message || "Failed to fetch qualifying totals");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Use the full cache if available, otherwise just the current page
  const totalsData = useMemo(() => {
    return allTotals || totals || {};
  }, [allTotals, totals]);

  const getFilterDisplayText = () => {
    const parts = [];
    parts.push(filters.event);
    parts.push(filters.gender);
    parts.push(filters.ageGroup[0].toUpperCase() + filters.ageGroup.slice(1));
    return parts.join(" • ");
  };

  const handleApplyFilters = () => {
    setFilters(tempFilters);
    setShowFilterModal(false);
  };

  const handleResetFilters = () => {
    const resetFilters: Filters = {
      event: "Nationals",
      gender: "Men",
      ageGroup: "Senior",
    };
    setFilters(resetFilters);
    setTempFilters(resetFilters);
  };

  const getCurrentTotals = () => {
    // Defensive: check all keys exist
    const eventData = totalsData[filters.event];
    if (!eventData) return [];
    const ageData = eventData[filters.ageGroup];
    if (!ageData) return [];
    const genderData = ageData[filters.gender];
    if (!genderData) return [];
    // genderData is now { [weightClass]: number }
    return Object.entries(genderData).map(([weightClass, qt]) => ({
      bodyweightDivision: weightClass,
      qt,
    }));
  };

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
        ? Object.keys(totalsData[selectedEvent])
            .filter((ageGroup) => typeof ageGroup === "string")
            .sort((a, b) => {
              const order = [
                "U11",
                "U13",
                "U15",
                "U17",
                "Junior",
                "University",
                "U23",
                "U25",
                "Senior",
              ];
              const aIndex = order.indexOf(a);
              const bIndex = order.indexOf(b);
              if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
              if (aIndex !== -1) return -1;
              if (bIndex !== -1) return 1;
              return a.localeCompare(b);
            })
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
            <ThemedText style={styles.headerCell}>Total</ThemedText>
          </View>

          {loading ? (
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
                style={[styles.cell, { flex: 2, textAlign: "center" }]}
              >
                Loading...
              </ThemedText>
            </View>
          ) : fetchError ? (
            <View style={styles.row}>
              <ThemedText style={[styles.cell, { flex: 2 }]}>
                {fetchError}
              </ThemedText>
            </View>
          ) : (
            getCurrentTotals().map((record, index, array) => (
              <View
                key={record.bodyweightDivision}
                style={[
                  styles.row,
                  index < array.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <ThemedText style={[styles.cell, { flex: 2 }]}>
                  {record.bodyweightDivision}
                </ThemedText>
                <ThemedText style={styles.cell}>
                  {record.qt}
                  kg
                </ThemedText>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <GenericFilterModal
        visible={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        sections={buildFilterSections}
        filters={{
          event: tempFilters.event,
          gender: tempFilters.gender,
          ageGroup: tempFilters.ageGroup,
        }}
        onApplyFilters={(newFilters) => {
          const updatedFilters = {
            event: newFilters.event,
            gender: newFilters.gender as Gender,
            ageGroup: newFilters.ageGroup,
          };
          setFilters(updatedFilters);
          setTempFilters(updatedFilters);
          setShowFilterModal(false);
        }}
        onResetFilters={handleResetFilters}
        resultCount={getCurrentTotals().length}
        resultLabel="weight classes"
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
    borderRadius: 12,
    overflow: "hidden",
    marginHorizontal: 16,
    maxHeight: "80%", // Fallback if windowHeight not available
  },
  modalScrollContent: {
    flexGrow: 0, // Changed from 1 to 0
  },
  filterSection: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterSectionButton: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
    paddingVertical: 8,
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
