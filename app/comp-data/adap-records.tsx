import { DataTable, dataTableStyles } from "@/components/ui/DataTable";
import { SubscriptionGate } from "@/components/ui/SubscriptionGate";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { useAppColors } from "@/hooks/useAppColors";
import { useFetchData } from "@/hooks/useFetchData";
import { fetchAdaptiveRecords } from "@/lib/database/fetch-adaptive-records";
import { RecordsData } from "@/types/records";
import { Stack } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

type Gender = "Men" | "Women";

const AGE_GROUP_KEY = "Adaptive";

const MENS_WEIGHT_CLASSES = [
  "60kg",
  "65kg",
  "71kg",
  "79kg",
  "88kg",
  "94kg",
  "110kg",
  "110+kg",
];
const WOMENS_WEIGHT_CLASSES = [
  "48kg",
  "53kg",
  "58kg",
  "63kg",
  "69kg",
  "77kg",
  "86kg",
  "86+kg",
];

const EMPTY_RECORDS_DATA: RecordsData = {} as RecordsData;

export default function AdaptiveRecordsScreen() {
  const colors = useAppColors();
  const [appliedGender, setAppliedGender] = useState<Gender>("Men");

  const fetchFn = useCallback(
    () => fetchAdaptiveRecords(appliedGender),
    [appliedGender],
  );
  const {
    data: recordsData,
    loading,
    error: fetchError,
  } = useFetchData<RecordsData>(fetchFn, EMPTY_RECORDS_DATA, [fetchFn]);

  const weightClasses =
    appliedGender === "Men" ? MENS_WEIGHT_CLASSES : WOMENS_WEIGHT_CLASSES;

  const filteredRecords = useMemo(() => {
    const list = recordsData[AGE_GROUP_KEY]?.[appliedGender] || [];
    const allowed = new Set(weightClasses);
    return list.filter((record) => allowed.has(record.weightClass));
  }, [recordsData, appliedGender, weightClasses]);

  return (
    <SubscriptionGate>
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Stack.Screen
        options={{
          title: "Adaptive American Records",
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

      <View
        style={[
          styles.segmentedContainer,
          { backgroundColor: colors.background },
        ]}
      >
        <View
          style={[
            styles.segmentedControl,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {(["Men", "Women"] as Gender[]).map((gender) => (
            <Pressable
              key={gender}
              style={({ pressed }) => [
                styles.segment,
                appliedGender === gender && { backgroundColor: colors.link },
                pressed && { opacity: 0.85 },
              ]}
              onPress={() => setAppliedGender(gender)}
            >
              <ThemedText
                style={[
                  styles.segmentText,
                  {
                    color:
                      appliedGender === gender
                        ? "#FFFFFF"
                        : colors.secondaryText,
                  },
                ]}
              >
                {gender}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </View>

      <DataTable
        columns={[
          { label: "Class", flex: 2 },
          { label: "Snatch" },
          { label: "CJ" },
          { label: "Total" },
        ]}
        data={filteredRecords}
        keyExtractor={(record, index) =>
          `${appliedGender}-${record.weightClass}-${index}`
        }
        loading={loading}
        error={fetchError}
        emptyMessage={`No adaptive records available for ${appliedGender === "Men" ? "men" : "women"}.`}
        loadingContent={
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={colors.link} />
            <ThemedText style={{ color: colors.secondaryText, marginTop: 8 }}>
              Loading...
            </ThemedText>
          </View>
        }
        renderRow={(record, index) => (
          <View
            style={[
              dataTableStyles.row,
              index < filteredRecords.length - 1 && {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: colors.border,
              },
            ]}
          >
            <ThemedText style={[dataTableStyles.cell, { flex: 2 }]}>
              {record.weightClass}
            </ThemedText>
            <ThemedText style={dataTableStyles.cell}>
              {record.snatchRecord}
              kg
            </ThemedText>
            <ThemedText style={dataTableStyles.cell}>
              {record.cjRecord}
              kg
            </ThemedText>
            <ThemedText style={dataTableStyles.cell}>
              {record.totalRecord}
              kg
            </ThemedText>
          </View>
        )}
      />
    </ThemedView>
    </SubscriptionGate>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  segmentedContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  segmentedControl: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentText: {
    fontSize: 15,
    fontWeight: "600",
  },
  loadingContainer: {
    padding: 24,
    alignItems: "center",
  },
});
