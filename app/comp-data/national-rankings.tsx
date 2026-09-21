import { DataTable } from "@/components/ui/DataTable";
import { useIsOffline } from "@/hooks/useIsOffline";
import { FilterBar } from "@/components/ui/FilterBar";
import { SubscriptionGate } from "@/components/ui/SubscriptionGate";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { FilterSection, GenericFilterModal } from "@/components/ui/filters";
import { AGE_GROUPS } from "@/constants/nat-rankings";
import { useTheme } from "@/contexts/ThemeContext";
import { useAppColors } from "@/hooks/useAppColors";
import { useFilterState } from "@/hooks/useFilterState";
import { useMutableResource } from "@/hooks/useMutableResource";
import {
  NationalRanking,
  nationalRankingsResource,
} from "@/lib/database/fetch-national-rankings";
import { isNetworkAvailable } from "@/lib/networkUtils";
import { FilterState, Gender } from "@/types/nat-rankings";
import { getWeightClasses } from "@/utils/nat-rankings";
import { Stack } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";

const EMPTY_RANKINGS: NationalRanking[] = [];

export default function NationalRankingsScreen() {
  return (
    <SubscriptionGate>
      <NationalRankingsScreenContent />
    </SubscriptionGate>
  );
}

function NationalRankingsScreenContent() {
  const screenInsets = useScreenHorizontalInsets();
  const colors = useAppColors();
  const { currentTheme } = useTheme();

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

  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useIsOffline();

  useEffect(() => {
    const classes = getWeightClasses(filters.gender as Gender, filters.ageGroup);
    if (!classes.includes(filters.weightClass) && classes.length > 0) {
      setFilters((prev) => ({ ...prev, weightClass: classes[0] }));
    }
  }, [filters.gender, filters.ageGroup, filters.weightClass, setFilters]);

  const resourceParams = useMemo(
    () => (filters.weightClass ? ([filters.weightClass] as [string]) : null),
    [filters.weightClass],
  );
  const {
    data: rankings,
    isInitialLoading: loading,
    error,
  } = useMutableResource({
    resource: nationalRankingsResource,
    params: resourceParams ?? ([] as unknown as [string]),
    initialData: EMPTY_RANKINGS,
    enabled: Boolean(resourceParams),
  });
  useEffect(() => {
    if (!error) {
      setFetchError(null);
      return;
    }
    let isCancelled = false;
    isNetworkAvailable()
      .then((hasNetwork) => {
        if (isCancelled) return;
        setIsOffline(!hasNetwork);
        setFetchError(
          hasNetwork
            ? error
            : "You're offline. Connect to refresh rankings.",
        );
      })
      .catch(() => {
        if (!isCancelled) setFetchError(error);
      });
    return () => {
      // The probe re-runs on every `error` change; without this an older probe
      // resolving late overwrites the newer error message.
      isCancelled = true;
    };
  }, [error, setIsOffline]);

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
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }, screenInsets]}
    >
      <Stack.Screen
        options={{
          title: "National Rankings",
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
        displayText={filters.weightClass}
        onPress={openFilters}
      />

      <DataTable
        columns={[
          { label: "Rank", width: 50 },
          { label: "Name", flex: 1 },
          { label: "Total", width: 80 },
        ]}
        data={rankings}
        keyExtractor={(athlete, index) => `${athlete.id}-${index}`}
        loading={loading}
        error={fetchError}
        emptyMessage={
          isOffline
            ? "You're offline. Connect to refresh rankings."
            : "No rankings available."
        }
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
              index < rankings.length - 1 && {
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
