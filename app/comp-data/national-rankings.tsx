import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useAppColors } from "@/hooks/useAppColors";
import {
  fetchNationalRankings,
  NationalRanking,
} from "@/lib/database/fetch-national-rankings";
import { Stack } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import PaywallScreen from "../shared-screens/paywall";

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

const windowHeight = Dimensions.get("window").height;
const maxOptionsHeight = windowHeight * 0.4;

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
  const { isSubscribed, isLoading: isSubscriptionLoading } = useSubscription();

  const [filters, setFilters] = useState<FilterState>({
    gender: "Men",
    ageGroup: "Senior",
    weightClass: "Open Men's 60kg",
  });
  const [tempFilters, setTempFilters] = useState<FilterState>(filters);
  const [expandedSection, setExpandedSection] = useState<
    "gender" | "ageGroup" | "weightClass" | null
  >(null);
  const [showFilterModal, setShowFilterModal] = useState(false);

  const [rankings, setRankings] = useState<NationalRanking[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    const classes = getWeightClasses(filters.gender, filters.ageGroup);
    if (!classes.includes(filters.weightClass) && classes.length > 0) {
      setFilters((prev) => ({ ...prev, weightClass: classes[0] }));
    }
  }, [filters.gender, filters.ageGroup]);

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

  const handleOpenFilters = () => {
    setTempFilters(filters);
    setExpandedSection(null);
    setShowFilterModal(true);
  };

  const handleApplyFilters = () => {
    setFilters(tempFilters);
    setShowFilterModal(false);
    setExpandedSection(null);
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
          title: "National Rankings",
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
              { backgroundColor: colors.card, borderColor: colors.border },
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={handleOpenFilters}
          >
            <ThemedText
              style={[styles.filterButtonText, { color: colors.secondaryText }]}
            >
              {filters.weightClass}
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
            <ThemedText
              style={[
                styles.headerCell,
                { width: 50, color: colors.secondaryText },
              ]}
            >
              Rank
            </ThemedText>
            <ThemedText
              style={[
                styles.headerCell,
                { flex: 1, color: colors.secondaryText },
              ]}
            >
              Name
            </ThemedText>
            <ThemedText
              style={[
                styles.headerCell,
                { width: 80, color: colors.secondaryText },
              ]}
            >
              Total
            </ThemedText>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.link} />
              <ThemedText style={{ color: colors.secondaryText, marginTop: 8 }}>
                Loading...
              </ThemedText>
            </View>
          ) : fetchError ? (
            <ThemedText
              style={{
                color: colors.danger,
                textAlign: "center",
                marginTop: 16,
              }}
            >
              {fetchError}
            </ThemedText>
          ) : rows.length === 0 ? (
            <ThemedText
              style={{
                textAlign: "center",
                marginTop: 16,
                color: colors.secondaryText,
              }}
            >
              No rankings available.
            </ThemedText>
          ) : (
            rows.map((athlete, index) => (
              <View
                key={`${athlete.id}-${index}`}
                style={[
                  styles.row,
                  index < rows.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <ThemedText
                  style={[styles.cell, { width: 50, color: colors.text }]}
                >
                  {index + 1}
                </ThemedText>
                <ThemedText
                  style={[styles.cell, { flex: 1, color: colors.text }]}
                  numberOfLines={1}
                >
                  {athlete.name}
                </ThemedText>
                <ThemedText
                  style={[styles.cell, { width: 80, color: colors.text }]}
                >
                  {Math.round(athlete.total)}
                  kg
                </ThemedText>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <Modal
        visible={showFilterModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setExpandedSection(null);
          setShowFilterModal(false);
        }}
      >
        <Pressable
          style={[
            styles.modalOverlay,
            {
              backgroundColor: colors.modalBackground,
            },
          ]}
          onPress={() => {
            setExpandedSection(null);
            setShowFilterModal(false);
          }}
        >
          <View
            style={[
              styles.modalContent,
              { backgroundColor: colors.card, maxHeight: windowHeight * 0.8 },
            ]}
          >
            <Pressable onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalScrollContent}>
                <ScrollView bounces={false}>
                  <View
                    style={[
                      styles.filterSection,
                      { borderBottomColor: colors.border },
                    ]}
                  >
                    <Pressable
                      style={({ pressed }) => [
                        styles.filterSectionButton,
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() =>
                        setExpandedSection(
                          expandedSection === "gender" ? null : "gender",
                        )
                      }
                    >
                      <View style={styles.filterSectionButtonContent}>
                        <View>
                          <ThemedText
                            style={[
                              styles.filterSectionLabel,
                              { color: colors.secondaryText },
                            ]}
                          >
                            Gender
                          </ThemedText>
                          <ThemedText
                            style={[
                              styles.filterSectionValue,
                              { color: colors.text },
                            ]}
                          >
                            {tempFilters.gender}
                          </ThemedText>
                        </View>
                        <IconSymbol
                          name={
                            expandedSection === "gender"
                              ? "chevron.down"
                              : "chevron.right"
                          }
                          size={16}
                          color={colors.secondaryText}
                        />
                      </View>
                    </Pressable>
                    {expandedSection === "gender" && (
                      <ScrollView
                        style={[
                          styles.filterOptions,
                          { borderTopColor: colors.border },
                        ]}
                        bounces={false}
                      >
                        {(["Men", "Women"] as Gender[]).map((gender) => (
                          <Pressable
                            key={gender}
                            style={({ pressed }) => [
                              styles.filterOption,
                              { borderBottomColor: colors.border },
                              tempFilters.gender === gender && {
                                backgroundColor: colors.pressed,
                              },
                              pressed && { opacity: 0.8 },
                            ]}
                            onPress={() => {
                              setTempFilters((prev) => {
                                const nextClasses = getWeightClasses(
                                  gender,
                                  prev.ageGroup,
                                );
                                return {
                                  ...prev,
                                  gender,
                                  weightClass:
                                    nextClasses.length > 0
                                      ? nextClasses[0]
                                      : prev.weightClass,
                                };
                              });
                              setExpandedSection(null);
                            }}
                          >
                            <ThemedText
                              style={[
                                styles.filterOptionText,
                                { color: colors.text },
                                tempFilters.gender === gender && {
                                  color: colors.link,
                                },
                              ]}
                            >
                              {gender}
                            </ThemedText>
                            {tempFilters.gender === gender && (
                              <IconSymbol
                                name="checkmark"
                                size={16}
                                color={colors.link}
                              />
                            )}
                          </Pressable>
                        ))}
                      </ScrollView>
                    )}
                  </View>

                  <View
                    style={[
                      styles.filterSection,
                      { borderBottomColor: colors.border },
                    ]}
                  >
                    <Pressable
                      style={({ pressed }) => [
                        styles.filterSectionButton,
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() =>
                        setExpandedSection(
                          expandedSection === "ageGroup" ? null : "ageGroup",
                        )
                      }
                    >
                      <View style={styles.filterSectionButtonContent}>
                        <View>
                          <ThemedText
                            style={[
                              styles.filterSectionLabel,
                              { color: colors.secondaryText },
                            ]}
                          >
                            Age Group
                          </ThemedText>
                          <ThemedText
                            style={[
                              styles.filterSectionValue,
                              { color: colors.text },
                            ]}
                          >
                            {tempFilters.ageGroup}
                          </ThemedText>
                        </View>
                        <IconSymbol
                          name={
                            expandedSection === "ageGroup"
                              ? "chevron.down"
                              : "chevron.right"
                          }
                          size={16}
                          color={colors.secondaryText}
                        />
                      </View>
                    </Pressable>
                    {expandedSection === "ageGroup" && (
                      <ScrollView
                        style={[
                          styles.filterOptions,
                          {
                            borderTopColor: colors.border,
                            maxHeight: maxOptionsHeight,
                          },
                        ]}
                        bounces={false}
                      >
                        {AGE_GROUPS.map((age) => (
                          <Pressable
                            key={age}
                            style={({ pressed }) => [
                              styles.filterOption,
                              { borderBottomColor: colors.border },
                              tempFilters.ageGroup === age && {
                                backgroundColor: colors.pressed,
                              },
                              pressed && { opacity: 0.8 },
                            ]}
                            onPress={() => {
                              const nextClasses = getWeightClasses(
                                tempFilters.gender,
                                age,
                              );
                              setTempFilters((prev) => ({
                                ...prev,
                                ageGroup: age,
                                weightClass:
                                  nextClasses.length > 0
                                    ? nextClasses[0]
                                    : prev.weightClass,
                              }));
                              setExpandedSection(null);
                            }}
                          >
                            <ThemedText
                              style={[
                                styles.filterOptionText,
                                { color: colors.text },
                                tempFilters.ageGroup === age && {
                                  color: colors.link,
                                },
                              ]}
                            >
                              {age}
                            </ThemedText>
                            {tempFilters.ageGroup === age && (
                              <IconSymbol
                                name="checkmark"
                                size={16}
                                color={colors.link}
                              />
                            )}
                          </Pressable>
                        ))}
                      </ScrollView>
                    )}
                  </View>

                  <View style={styles.filterSection}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.filterSectionButton,
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() =>
                        setExpandedSection(
                          expandedSection === "weightClass"
                            ? null
                            : "weightClass",
                        )
                      }
                    >
                      <View style={styles.filterSectionButtonContent}>
                        <View>
                          <ThemedText
                            style={[
                              styles.filterSectionLabel,
                              { color: colors.secondaryText },
                            ]}
                          >
                            Weight Class
                          </ThemedText>
                          <ThemedText
                            style={[
                              styles.filterSectionValue,
                              { color: colors.text },
                            ]}
                          >
                            {tempFilters.weightClass}
                          </ThemedText>
                        </View>
                        <IconSymbol
                          name={
                            expandedSection === "weightClass"
                              ? "chevron.down"
                              : "chevron.right"
                          }
                          size={16}
                          color={colors.secondaryText}
                        />
                      </View>
                    </Pressable>
                    {expandedSection === "weightClass" && (
                      <ScrollView
                        style={[
                          styles.filterOptions,
                          {
                            borderTopColor: colors.border,
                            maxHeight: maxOptionsHeight,
                          },
                        ]}
                        bounces={false}
                      >
                        {getWeightClasses(
                          tempFilters.gender,
                          tempFilters.ageGroup,
                        ).map((weightClass) => (
                          <Pressable
                            key={weightClass}
                            style={({ pressed }) => [
                              styles.filterOption,
                              { borderBottomColor: colors.border },
                              tempFilters.weightClass === weightClass && {
                                backgroundColor: colors.pressed,
                              },
                              pressed && { opacity: 0.8 },
                            ]}
                            onPress={() => {
                              setTempFilters((prev) => ({
                                ...prev,
                                weightClass,
                              }));
                              setExpandedSection(null);
                            }}
                          >
                            <ThemedText
                              style={[
                                styles.filterOptionText,
                                { color: colors.text },
                                tempFilters.weightClass === weightClass && {
                                  color: colors.link,
                                },
                              ]}
                            >
                              {weightClass}
                            </ThemedText>
                            {tempFilters.weightClass === weightClass && (
                              <IconSymbol
                                name="checkmark"
                                size={16}
                                color={colors.link}
                              />
                            )}
                          </Pressable>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                </ScrollView>
              </View>

              <View
                style={[styles.modalFooter, { borderTopColor: colors.border }]}
              >
                <Pressable
                  style={({ pressed }) => [
                    styles.applyButton,
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={handleApplyFilters}
                >
                  <ThemedText style={styles.applyButtonText}>Apply</ThemedText>
                </Pressable>
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
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
    fontSize: 15,
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
    padding: 16,
    alignItems: "center",
  },
  cell: {
    fontSize: 16,
  },
  loadingContainer: {
    padding: 24,
    alignItems: "center",
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
