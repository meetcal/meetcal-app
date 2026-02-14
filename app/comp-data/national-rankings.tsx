import { DataTable } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { SubscriptionGate } from "@/components/ui/SubscriptionGate";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { FilterSection, GenericFilterModal } from "@/components/ui/filters";
import { useAppColors } from "@/hooks/useAppColors";
import { useFilterState } from "@/hooks/useFilterState";
import {
  fetchNationalRankings,
  NationalRanking,
} from "@/lib/database/fetch-national-rankings";
import { Stack } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

type Gender = "Men" | "Women";

type FilterState = {
  gender: Gender;
  ageGroup: string;
  weightClass: string;
};

const AGE_GROUPS = [
  "U11",
  "U13",
  "U15",
  "U17",
  "Junior",
  "Senior",
  "Masters 35",
  "Masters 40",
  "Masters 45",
  "Masters 50",
  "Masters 55",
  "Masters 60",
  "Masters 65",
  "Masters 70",
  "Masters 75",
  "Masters 80",
  "Masters 85",
  "Masters 90+",
];

function getWeightClasses(gender: Gender, ageGroup: string): string[] {
  let prefix = `Open ${gender}`;

  switch (ageGroup) {
    case "U11":
      prefix = `${gender}'s 11 Under Age Group`;
      break;
    case "U13":
      prefix = `${gender}'s 13 Under Age Group`;
      break;
    case "U15":
      prefix = `${gender}'s 14-15 Age Group`;
      break;
    case "U17":
      prefix = `${gender}'s 16-17 Age Group`;
      break;
    case "Junior":
      prefix = `Junior ${gender}`;
      break;
    case "Senior":
      prefix = `Open ${gender}`;
      break;
    case "Masters 35":
      prefix = `${gender}'s Masters (35-39)`;
      break;
    case "Masters 40":
      prefix = `${gender}'s Masters (40-44)`;
      break;
    case "Masters 45":
      prefix = `${gender}'s Masters (45-49)`;
      break;
    case "Masters 50":
      prefix = `${gender}'s Masters (50-54)`;
      break;
    case "Masters 55":
      prefix = `${gender}'s Masters (55-59)`;
      break;
    case "Masters 60":
      prefix = `${gender}'s Masters (60-64)`;
      break;
    case "Masters 65":
      prefix = `${gender}'s Masters (65-69)`;
      break;
    case "Masters 70":
      prefix = `${gender}'s Masters (70-74)`;
      break;
    case "Masters 75":
      prefix = `${gender}'s Masters (75-79)`;
      break;
    case "Masters 80":
      prefix = `${gender}'s Masters (80-84)`;
      break;
    case "Masters 85":
      prefix = `${gender}'s Masters (85-89)`;
      break;
    case "Masters 90+":
      prefix = `${gender}'s Masters (90+)`;
      break;
    default:
      prefix = `Open ${gender}`;
  }

  switch (`${gender}-${ageGroup}`) {
    case "Men-Masters 35":
    case "Men-Masters 40":
    case "Men-Masters 45":
    case "Men-Masters 50":
    case "Men-Masters 55":
    case "Men-Masters 60":
    case "Men-Masters 65":
    case "Men-Masters 70":
    case "Men-Masters 75":
    case "Men-Masters 80":
    case "Men-Masters 85":
    case "Men-Masters 90+":
      return [
        "60kg",
        "65kg",
        "71kg",
        "79kg",
        "88kg",
        "94kg",
        "110kg",
        "110+kg",
      ].map((w) => `${prefix} ${w}`);
    case "Women-Masters 35":
    case "Women-Masters 40":
    case "Women-Masters 45":
    case "Women-Masters 50":
    case "Women-Masters 55":
    case "Women-Masters 60":
    case "Women-Masters 65":
    case "Women-Masters 70":
    case "Women-Masters 75":
    case "Women-Masters 80":
    case "Women-Masters 85":
    case "Women-Masters 90+":
      return [
        "48kg",
        "53kg",
        "58kg",
        "63kg",
        "69kg",
        "77kg",
        "86kg",
        "86+kg",
      ].map((w) => `${prefix} ${w}`);
    case "Men-Junior":
    case "Men-Senior":
      return [
        "60kg",
        "65kg",
        "71kg",
        "79kg",
        "88kg",
        "94kg",
        "110kg",
        "110+kg",
      ].map((w) => `${prefix}'s ${w}`);
    case "Women-Junior":
    case "Women-Senior":
      return [
        "48kg",
        "53kg",
        "58kg",
        "63kg",
        "69kg",
        "77kg",
        "86kg",
        "86+kg",
      ].map((w) => `${prefix}'s ${w}`);
    case "Men-U17":
      return [
        "56kg",
        "60kg",
        "65kg",
        "71kg",
        "79kg",
        "88kg",
        "94kg",
        "94+kg",
      ].map((w) => `${prefix} ${w}`);
    case "Women-U17":
      return [
        "44kg",
        "48kg",
        "53kg",
        "58kg",
        "63kg",
        "69kg",
        "77kg",
        "77+kg",
      ].map((w) => `${prefix} ${w}`);
    case "Men-U15":
      return [
        "48kg",
        "52kg",
        "56kg",
        "60kg",
        "65kg",
        "71kg",
        "79kg",
        "79+kg",
      ].map((w) => `${prefix} ${w}`);
    case "Women-U15":
      return [
        "40kg",
        "44kg",
        "48kg",
        "53kg",
        "58kg",
        "63kg",
        "69kg",
        "69+kg",
      ].map((w) => `${prefix} ${w}`);
    case "Men-U13":
    case "Men-U11":
      return [
        "40kg",
        "44kg",
        "48kg",
        "52kg",
        "56kg",
        "60kg",
        "65kg",
        "65+kg",
      ].map((w) => `${prefix} ${w}`);
    case "Women-U13":
    case "Women-U11":
      return [
        "36kg",
        "40kg",
        "44kg",
        "48kg",
        "53kg",
        "58kg",
        "63kg",
        "63+kg",
      ].map((w) => `${prefix} ${w}`);
    default:
      return [];
  }
}

export default function NationalRankingsScreen() {
  const colors = useAppColors();

  const {
    filters,
    setFilters,
    openFilters,
    filterModalProps,
  } = useFilterState<FilterState>({
    defaultFilters: {
      gender: "Men",
      ageGroup: "Senior",
      weightClass: "Open Men's 60kg",
    },
  });

  const [rankings, setRankings] = useState<NationalRanking[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

   
  useEffect(() => {
    const classes = getWeightClasses(filters.gender, filters.ageGroup);
    if (!classes.includes(filters.weightClass) && classes.length > 0) {
      setFilters((prev) => ({ ...prev, weightClass: classes[0] }));
    }
  }, [filters.gender, filters.ageGroup, filters.weightClass, setFilters]);

  useEffect(() => {
    let cancelled = false;
    if (!filters.weightClass) return;

    setLoading(true);
    setFetchError(null);

    fetchNationalRankings(filters.weightClass)
      .then((data) => {
        if (!cancelled) {
          setRankings(data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchError(err?.message || "Failed to fetch national rankings");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filters.weightClass]);

  const rows = useMemo(() => rankings, [rankings]);

  const handleResetFilters = () => {
    const reset = {
      gender: "Men" as Gender,
      ageGroup: "Senior",
      weightClass: "",
    };
    setFilters(reset);
  };

  // Build filter sections dynamically based on tempFilters
  const buildFilterSections = (
    tempFilters: Record<string, string>,
  ): FilterSection[] => {
    const gender = (tempFilters.gender || "Men") as Gender;
    const ageGroup = tempFilters.ageGroup || "Senior";
    const weightClasses = getWeightClasses(gender, ageGroup);

    return [
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
        options: AGE_GROUPS.map((ag) => ({ value: ag, label: ag })),
        allOptionLabel: "All Age Groups",
      },
      {
        id: "weightClass",
        title: "Weight Class",
        options: weightClasses.map((wc) => ({ value: wc, label: wc })),
        dependsOn: ["gender", "ageGroup"],
      },
    ];
  };

  return (
    <SubscriptionGate>
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Stack.Screen
        options={{
          title: "National Rankings",
          headerBackTitle: "Back",
          headerShown: true,
          gestureEnabled: true,
          gestureDirection: "horizontal",
          animation: "slide_from_right",
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
        }}
      />

      <FilterBar
        displayText={filters.weightClass}
        onPress={openFilters}
      />

      <DataTable
        columns={[
          { label: "Rank", width: 50 },
          { label: "Name", flex: 1 },
          { label: "Total", width: 80 },
        ]}
        data={rows}
        keyExtractor={(athlete, index) => `${athlete.id}-${index}`}
        loading={loading}
        error={fetchError}
        emptyMessage="No rankings available."
        loadingContent={
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={colors.link} />
            <ThemedText style={{ color: colors.secondaryText, marginTop: 8 }}>
              Loading...
            </ThemedText>
          </View>
        }
        renderRow={(athlete, index) => (
          <View
            style={[
              styles.row,
              index < rows.length - 1 && {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: colors.border,
              },
            ]}
          >
            <ThemedText style={styles.rankText}>{index + 1}</ThemedText>
            <ThemedText style={styles.nameText}>
              {athlete.name}
            </ThemedText>
            <ThemedText style={styles.totalText}>
              {athlete.total}
kg
</ThemedText>
          </View>
        )}
      />

      <GenericFilterModal
        {...filterModalProps}
        sections={buildFilterSections}
        onResetFilters={handleResetFilters}
        resultCount={rankings.length}
        resultLabel="rankings"
      />
    </ThemedView>
    </SubscriptionGate>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  row: {
    flexDirection: "row",
    padding: 16,
    alignItems: "center",
  },
  loadingContainer: {
    padding: 24,
    alignItems: "center",
  },
  nameText: {
    flex: 1,
    fontSize: 16,
  },
  rankText: {
    width: 50,
    fontSize: 16,
    textAlign: "center",
  },
  totalText: {
    width: 80,
    fontSize: 16,
    textAlign: "left",
  },
});
