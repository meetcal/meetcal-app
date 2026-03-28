import { DataTable } from "@/components/ui/DataTable";
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
  IntlRanking,
  intlRankingsResource,
} from "@/lib/database/fetchIntlRankings";
import { sortAgeGroups } from "@/lib/sortAgeGroups";
import { Filters } from "@/types/rankings";
import { Stack } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

export default function RecordsScreen() {
  const colors = useAppColors();
  const { currentTheme } = useTheme();
  const {
    filters,
    setFilters,
    setTempFilters,
    openFilters,
    filterModalProps,
  } = useFilterState<Filters>({
    defaultFilters: { meet: "", age_category: "", gender: "" },
  });

  const [intlRankings, setIntlRankings] = useState<IntlRanking[]>([]);
  const {
    data,
    isInitialLoading: loading,
    error: fetchError,
  } = useMutableResource({
    resource: intlRankingsResource,
    params: [] as const,
    initialData: [] as IntlRanking[],
  });
  useEffect(() => {
    setIntlRankings(data);
  }, [data]);

  // Only set default filters the first time rankings are loaded
  const [hasSetDefaultFilters, setHasSetDefaultFilters] = useState(false);
  useEffect(() => {
    if (!hasSetDefaultFilters && intlRankings.length > 0) {
      const availableAgeCategories = Array.from(
        new Set(
          intlRankings.map((r) =>
            typeof r.ageCategory === "string" ? r.ageCategory : "",
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

  // Filter age category options based on the applied meet
  const ageCategoryOptions = useMemo(() => {
    const filteredData = filters.meet
      ? intlRankings.filter((r) => r.meet === filters.meet)
      : intlRankings;

    return sortAgeGroups(
      Array.from(
        new Set(
          filteredData.map((r) =>
            typeof r.ageCategory === "string" ? r.ageCategory : "",
          ),
        ),
      ).filter(Boolean),
      { includeExtended: true },
    );
  }, [filters.meet, intlRankings]);

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
          (!filters.age_category || r.ageCategory === filters.age_category) &&
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

  const buildFilterSections = (
    modalTempFilters: Record<string, string>,
  ): FilterSection[] => {
    const selectedMeet = modalTempFilters.meet || filters.meet;
    const modalAgeCategoryOptions = sortAgeGroups(
      Array.from(
        new Set(
          (selectedMeet
            ? intlRankings.filter((ranking) => ranking.meet === selectedMeet)
            : intlRankings
          ).map((ranking) =>
            typeof ranking.ageCategory === "string"
              ? ranking.ageCategory
              : "",
          ),
        ),
      ).filter(Boolean),
      { includeExtended: true },
    );

    return [
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
        options: modalAgeCategoryOptions.map((age) => ({
          value: age,
          label: age,
        })),
        dependsOn: ["meet"],
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
  };

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
            headerTitleStyle: {
              color: currentTheme === "dark" ? "#fff" : "#000",
            },
            headerStyle: {
              backgroundColor: currentTheme === "dark" ? "#000000" : "#F5F5F5",
            },
            headerShadowVisible: false,
            headerBackButtonDisplayMode: "minimal",
            headerTintColor: colors.text
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
                {typeof ranking.percentA === "number"
                  ? `${ranking.percentA.toFixed(2)}%`
                  : ""}
              </ThemedText>
            </View>
          )}
        />

        <GenericFilterModal
          {...filterModalProps}
          sections={buildFilterSections}
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
