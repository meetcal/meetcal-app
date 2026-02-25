import { DataTable } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { SubscriptionGate } from "@/components/ui/SubscriptionGate";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { FilterSection, GenericFilterModal } from "@/components/ui/filters";
import { AGE_GROUPS } from "@/constants/nat-rankings";
import { useAppColors } from "@/hooks/useAppColors";
import { useFilterState } from "@/hooks/useFilterState";
import {
  fetchNationalRankings,
  NationalRanking,
} from "@/lib/database/fetch-national-rankings";
import {
  isNetworkAvailable,
  subscribeToNetworkChanges,
} from "@/lib/networkUtils";
import { FilterState, Gender } from "@/types/nat-rankings";
import { getWeightClasses } from "@/utils/nat-rankings";
import { Stack } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

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
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    let mounted = true;
    isNetworkAvailable()
      .then((hasNetwork) => {
        if (mounted) {
          setIsOffline(!hasNetwork);
        }
      })
      .catch(() => {
        if (mounted) {
          setIsOffline(false);
        }
      });

    const unsubscribe = subscribeToNetworkChanges((isConnected) => {
      setIsOffline(!isConnected);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const classes = getWeightClasses(filters.gender as Gender, filters.ageGroup);
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
          isNetworkAvailable()
            .then((hasNetwork) => {
              if (cancelled) return;
              setIsOffline(!hasNetwork);
              setFetchError(
                hasNetwork
                  ? err?.message || "Failed to fetch national rankings"
                  : "You're offline. Connect to refresh rankings.",
              );
            })
            .catch(() => {
              if (cancelled) return;
              setFetchError(err?.message || "Failed to fetch national rankings");
            });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filters.weightClass]);

  const rows = rankings;

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
