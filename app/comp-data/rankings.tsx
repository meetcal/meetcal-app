import { DataTable } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { SubscriptionGate } from "@/components/ui/SubscriptionGate";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { FilterSection, GenericFilterModal } from "@/components/ui/filters";
import { useAppColors } from "@/hooks/useAppColors";
import { useFilterState } from "@/hooks/useFilterState";
import {
  fetchIntlRankings,
  IntlRanking,
} from "@/lib/database/fetchIntlRankings";
import { sortAgeGroups } from "@/lib/sortAgeGroups";
import { Filters } from "@/types/rankings";
import { Stack } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

export default function RecordsScreen() {
  const colors = useAppColors();
  const {
    filters,
    setFilters,
    tempFilters,
    setTempFilters,
    openFilters,
    filterModalProps,
  } = useFilterState<Filters>({
    defaultFilters: { meet: "", age_category: "", gender: "" },
  });

  const [intlRankings, setIntlRankings] = useState<IntlRanking[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError(null);

    fetchIntlRankings()
      .then((data) => {
        if (cancelled) return;
        setIntlRankings(data);
        setLoading(false);
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
      const availableAgeCategories = Array.from(
        new Set(
          intlRankings.map((r) =>
            typeof r.age_category === "string" ? r.age_category : "",
          ),
        ),
      ).filter(Boolean);
      const availableGenders = Array.from(
        new Set(
          intlRankings.map((r) =>
            typeof r.gender === "string" ? r.gender : "",
          ),
        ),
      ).filter(Boolean);

      const defaultMeet =
        typeof intlRankings[0].meet === "string" ? intlRankings[0].meet : "";
      const defaultAgeCategory = availableAgeCategories.includes("Senior")
        ? "Senior"
        : availableAgeCategories[0] || "";
      const defaultGender = availableGenders.includes("Men")
        ? "Men"
        : availableGenders[0] || "";

      const defaults: Filters = {
        meet: defaultMeet,
        age_category: defaultAgeCategory,
        gender: defaultGender,
      };
      setFilters(defaults);
      setTempFilters(defaults);
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

    return sortAgeGroups(
      Array.from(
        new Set(
          filteredData.map((r) =>
            typeof r.age_category === "string" ? r.age_category : "",
          ),
        ),
      ).filter(Boolean),
      { includeExtended: true },
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

  return (
    <SubscriptionGate>
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

        <FilterBar displayText={getFilterDisplayText()} onPress={openFilters} />

        <DataTable
          columns={[
            { label: "Name", width: "50%", headerStyle: styles.headerCell },
            { label: "Total", width: "25%", headerStyle: styles.headerCell },
            { label: "% of A", width: "25%", headerStyle: styles.headerCell },
          ]}
          data={filteredRankings}
          keyExtractor={(_ranking, index) => String(index)}
          loading={loading}
          error={fetchError}
          emptyMessage="No rankings available."
          renderRow={(ranking, index) => (
            <View
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
          )}
        />

        <GenericFilterModal
          {...filterModalProps}
          sections={filterSections}
          onResetFilters={handleResetFilters}
          resultCount={filteredRankings.length}
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
    alignItems: "center",
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  headerCell: {
    textAlign: "center",
    paddingHorizontal: 4,
  },
  cell: {
    fontSize: 17,
    textAlign: "center",
    paddingHorizontal: 4,
  },
});
