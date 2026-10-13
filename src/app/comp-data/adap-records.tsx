import { DataTable, dataTableStyles } from "@/components/ui/DataTable";
import { SubscriptionGate } from "@/components/ui/SubscriptionGate";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { EMPTY_RECORDS_DATA } from "@/constants/adapative";
import { useAppColors } from "@/hooks/useAppColors";
import { useMutableResource } from "@/hooks/useMutableResource";
import { adaptiveRecordsFor, adaptiveRecordsResource } from "@/lib/database/fetch-adaptive-records";
import { RecordsData } from "@/types/records";
import { Stack } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";
import { formatReferenceKg } from "@/lib/reference-values";
import { Palette } from "@/constants/Palette";

type Gender = "Men" | "Women";

export default function AdaptiveRecordsScreen() {
  return (
    <SubscriptionGate>
      <AdaptiveRecordsScreenContent />
    </SubscriptionGate>
  );
}

function AdaptiveRecordsScreenContent() {
  const screenInsets = useScreenHorizontalInsets();
  const colors = useAppColors();
  const [appliedGender, setAppliedGender] = useState<Gender>("Men");

  const {
    data: recordsData,
    isInitialLoading,
    error: fetchError,
  } = useMutableResource({
    resource: adaptiveRecordsResource,
    params: [] as const,
    initialData: EMPTY_RECORDS_DATA as RecordsData,
  });

  const filteredRecords = useMemo(
    () => adaptiveRecordsFor(recordsData, appliedGender),
    [recordsData, appliedGender],
  );

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }, screenInsets]}
    >
      <Stack.Screen
        options={{
          title: "Adaptive American Records",
          headerBackTitle: "Back",
          headerShown: true,
          gestureEnabled: true,
          gestureDirection: "horizontal",
          animation: "slide_from_right",
          headerTitleStyle: {
            color: colors.headerTitle,
          },
          headerStyle: {
            backgroundColor: colors.headerBackground,
          },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
          headerTintColor: colors.text,
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
          accessibilityRole="tablist"
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
              accessibilityRole="tab"
              accessibilityState={{ selected: appliedGender === gender }}
            >
              <ThemedText
                style={[
                  styles.segmentText,
                  {
                    color:
                      appliedGender === gender
                        ? Palette.white
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
        loading={isInitialLoading}
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
              {formatReferenceKg(record.snatchRecord)}
            </ThemedText>
            <ThemedText style={dataTableStyles.cell}>
              {formatReferenceKg(record.cjRecord)}
            </ThemedText>
            <ThemedText style={dataTableStyles.cell}>
              {formatReferenceKg(record.totalRecord)}
            </ThemedText>
          </View>
        )}
      />
    </ThemedView>
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
