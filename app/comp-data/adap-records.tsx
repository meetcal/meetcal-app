import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useAppColors } from "@/hooks/useAppColors";
import { fetchAdaptiveRecords } from "@/lib/database/fetch-adaptive-records";
import { RecordsData, WeightClassRecord } from "@/types/records";
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
  const { isSubscribed, isLoading: isSubscriptionLoading } = useSubscription();
  const [appliedGender, setAppliedGender] = useState<Gender>("Men");
  const [records, setRecords] = useState<RecordsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError(null);

    fetchAdaptiveRecords(appliedGender)
      .then((data) => {
        if (!cancelled) {
          setRecords(data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchError(err?.message || "Failed to fetch adaptive records");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [appliedGender]);

  const recordsData = useMemo(() => records || EMPTY_RECORDS_DATA, [records]);

  const weightClasses =
    appliedGender === "Men" ? MENS_WEIGHT_CLASSES : WOMENS_WEIGHT_CLASSES;

  const filteredRecords = useMemo(() => {
    const list = recordsData[AGE_GROUP_KEY]?.[appliedGender] || [];
    const allowed = new Set(weightClasses);
    return list.filter((record) => allowed.has(record.weightClass));
  }, [recordsData, appliedGender, weightClasses]);

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
          title: "Adaptive American Records",
          headerBackTitle: "Back",
          headerShown: true,
          gestureEnabled: true,
          gestureDirection: "horizontal",
          animation: "slide_from_right",
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
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

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View
            style={[styles.headerRow, { borderBottomColor: colors.border }]}
          >
            <ThemedText
              style={[
                styles.headerCell,
                { flex: 2, color: colors.secondaryText },
              ]}
            >
              Class
            </ThemedText>
            <ThemedText
              style={[styles.headerCell, { color: colors.secondaryText }]}
            >
              Snatch
            </ThemedText>
            <ThemedText
              style={[styles.headerCell, { color: colors.secondaryText }]}
            >
              CJ
            </ThemedText>
            <ThemedText
              style={[styles.headerCell, { color: colors.secondaryText }]}
            >
              Total
            </ThemedText>
          </View>

          {loading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.link} />
              <ThemedText style={{ color: colors.secondaryText, marginTop: 8 }}>
                Loading...
              </ThemedText>
            </View>
          )}

          {fetchError && !loading && (
            <ThemedText
              style={{
                color: colors.danger,
                textAlign: "center",
                marginTop: 16,
              }}
            >
              {fetchError}
            </ThemedText>
          )}

          {!loading && !fetchError && filteredRecords.length === 0 && (
            <ThemedText
              style={{
                textAlign: "center",
                marginTop: 16,
                color: colors.secondaryText,
              }}
            >
              No adaptive records available for
{" "}
              {appliedGender === "Men" ? "men" : "women"}
.
</ThemedText>
          )}

          {!loading &&
            !fetchError &&
            filteredRecords.length > 0 &&
            filteredRecords.map((record: WeightClassRecord, index: number) => (
              <View
                key={`${appliedGender}-${record.weightClass}-${index}`}
                style={[
                  styles.row,
                  index < filteredRecords.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <ThemedText
                  style={[styles.cell, { flex: 2, color: colors.text }]}
                >
                  {record.weightClass}
                </ThemedText>
                <ThemedText style={[styles.cell, { color: colors.text }]}>
                  {record.snatchRecord}
                  kg
                </ThemedText>
                <ThemedText style={[styles.cell, { color: colors.text }]}>
                  {record.cjRecord}
                  kg
                </ThemedText>
                <ThemedText style={[styles.cell, { color: colors.text }]}>
                  {record.totalRecord}
                  kg
                </ThemedText>
              </View>
            ))}
        </View>
      </ScrollView>
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
    fontSize: 16,
  },
  loadingContainer: {
    padding: 24,
    alignItems: "center",
  },
});
