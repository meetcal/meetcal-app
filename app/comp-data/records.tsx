import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useAppColors } from "@/hooks/useAppColors";
import {
  fetchAgeGroups,
  fetchFederations,
  fetchRecords,
} from "@/lib/database/fetch-records";
import { RecordsData, WeightClassRecord } from "@/types/records";
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

type Federation = string;
type Gender = "Men" | "Women";
type AgeGroup = string; // Changed from specific union

// Helper to create an empty RecordsData structure - this might need refinement
// For now, an empty object will be used as RecordsData can have dynamic keys
const EMPTY_RECORDS_DATA: RecordsData = {} as RecordsData;

interface Filters {
  federation: Federation;
  gender: Gender;
  ageGroup: AgeGroup;
}

const windowHeight = Dimensions.get("window").height;
const maxOptionsHeight = windowHeight * 0.4;

export default function RecordsScreen() {
  const colors = useAppColors();
  const { isSubscribed, isLoading: isSubscriptionLoading } = useSubscription();
  const [availableFederations, setAvailableFederations] = useState<string[]>(
    [],
  );
  const [currentAvailableAgeGroupsList, setCurrentAvailableAgeGroupsList] =
    useState<string[]>([]);
  const [modalFederationForAgeGroups, setModalFederationForAgeGroups] =
    useState<string | null>(null);

  const [filters, setFilters] = useState<Filters>({
    federation: "",
    gender: "Men",
    ageGroup: "",
  });
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [expandedSection, setExpandedSection] = useState<
    "federation" | "gender" | "ageGroup" | null
  >(null);
  const [tempFilters, setTempFilters] = useState<Filters>(filters);

  const [records, setRecords] = useState<RecordsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [allRecords, setAllRecords] = useState<RecordsData | null>(null);

  // Effect for initial federation and age group loading
  useEffect(() => {
    async function loadInitialFilters() {
      setLoading(true);
      let determinedFederation = "";
      let determinedAgeGroup = "Senior";
      const defaultGender = "Men";

      try {
        const fetchedFederations = await fetchFederations();
        const filteredFederations = fetchedFederations.filter(
          (federation) => federation.toUpperCase() !== "BWL",
        );
        setAvailableFederations(filteredFederations);

        const preferredFederation = "USAW";
        const preferredAgeGroup = "Senior";

        if (filteredFederations.length > 0) {
          if (filteredFederations.includes(preferredFederation)) {
            determinedFederation = preferredFederation;
            determinedAgeGroup = preferredAgeGroup;
          } else {
            determinedFederation = filteredFederations[0];
            determinedAgeGroup = preferredAgeGroup;
          }
        } else {
          setFetchError("No federations found.");
          determinedAgeGroup = "";
        }

        setFilters({
          federation: determinedFederation,
          gender: defaultGender,
          ageGroup: determinedAgeGroup,
        });
        setTempFilters({
          federation: determinedFederation,
          gender: defaultGender,
          ageGroup: determinedAgeGroup,
        });
        // If modal were to open immediately, ensure its age groups are for determinedFederation
        // This is handled by the modal opening effect logic now, by checking against modalFederationForAgeGroups
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : "Failed to fetch initial filter data";
        setFetchError(errorMessage);
        // Set empty filters on error to prevent crashes, records effect will handle loading false
        setFilters({ federation: "", gender: defaultGender, ageGroup: "" });
        setTempFilters({ federation: "", gender: defaultGender, ageGroup: "" });
      } finally {
        // setLoading(false); // Loading is primarily for the records fetch, not initial filter setup.
        // The records fetch effect will set loading true/false.
      }
    }
    loadInitialFilters();
  }, []);

  // Effect for syncing tempFilters and preparing for modal age group loading when modal opens
  useEffect(() => {
    if (showFilterModal) {
      setTempFilters(filters); // Sync with current applied filters
      // If the modal is opening with a federation different from what age groups are loaded for,
      // or if no age groups loaded for it yet, reset modalFederationForAgeGroups to trigger a load.
      if (filters.federation !== modalFederationForAgeGroups) {
        setModalFederationForAgeGroups(null);
      }
    } else {
      // Optionally clear modal-specific states when it closes
      // setCurrentAvailableAgeGroupsList([]);
      // setModalFederationForAgeGroups(null);
    }
  }, [showFilterModal, filters]); // Re-evaluate if modal opens or if main filters change

  // Effect for updating age groups in the modal when tempFilters.federation changes, or when modal needs initial load.
  useEffect(() => {
    if (!showFilterModal || !tempFilters.federation) {
      // If modal is not shown, or no temp federation is selected, do nothing.
      // Clearing list if modal closes can be done in the previous effect.
      return;
    }

    // Fetch if the current temp federation is different from the one we last loaded age groups for.
    if (tempFilters.federation !== modalFederationForAgeGroups) {
      let isStale = false;
      const federationToFetch = tempFilters.federation;
      const currentTempAgeGroup = tempFilters.ageGroup; // Preserve current selection

      setCurrentAvailableAgeGroupsList([]); // Clear previous list, indicates loading

      fetchAgeGroups(federationToFetch)
        .then((fetchedAgeGroups) => {
          if (isStale || tempFilters.federation !== federationToFetch) return;

          setCurrentAvailableAgeGroupsList(fetchedAgeGroups);
          setModalFederationForAgeGroups(federationToFetch);

          // Try to preserve the current age group selection if it exists in the new list
          let newAgeGroup = "";
          if (fetchedAgeGroups.includes(currentTempAgeGroup)) {
            newAgeGroup = currentTempAgeGroup;
          } else if (fetchedAgeGroups.length > 0) {
            newAgeGroup = fetchedAgeGroups[0];
          }

          setTempFilters((prev) => ({ ...prev, ageGroup: newAgeGroup }));
        })
        .catch((err) => {
          if (isStale || tempFilters.federation !== federationToFetch) return;
          console.error(
            `Failed to fetch age groups for ${federationToFetch} in modal`,
            err,
          );
          setCurrentAvailableAgeGroupsList([]);
          setModalFederationForAgeGroups(federationToFetch); // Mark attempt to prevent loops
          // Optionally set a specific error message for the modal filter section
        })
        .finally(() => {
          if (isStale || tempFilters.federation !== federationToFetch) return;
        });

      return () => {
        isStale = true;
      };
    }
  }, [showFilterModal, tempFilters.federation, modalFederationForAgeGroups]);

  // Fetch full federation records once per federation selection.
  useEffect(() => {
    if (!filters.federation) {
      setLoading(false);
      setRecords(null);
      setAllRecords(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFetchError(null);

    fetchRecords(filters.federation)
      .then((data) => {
        if (!cancelled) {
          const nextAgeGroups = Object.keys(data);
          setCurrentAvailableAgeGroupsList(nextAgeGroups);
          setModalFederationForAgeGroups(filters.federation);
          setAllRecords(data);
          setRecords(data);

          if (
            nextAgeGroups.length > 0 &&
            !nextAgeGroups.includes(filters.ageGroup)
          ) {
            setFilters((prev) => ({ ...prev, ageGroup: nextAgeGroups[0] }));
          }
          if (
            nextAgeGroups.length > 0 &&
            !nextAgeGroups.includes(tempFilters.ageGroup)
          ) {
            setTempFilters((prev) => ({ ...prev, ageGroup: nextAgeGroups[0] }));
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchError(err.message || "Failed to fetch records");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filters.federation]);

  const recordsData = useMemo(() => {
    return allRecords || records || EMPTY_RECORDS_DATA;
  }, [allRecords, records]);

  const displayAgeGroup = useMemo(() => {
    if (!filters.ageGroup && currentAvailableAgeGroupsList.length > 0) {
      return currentAvailableAgeGroupsList[0];
    }
    if (currentAvailableAgeGroupsList.includes(filters.ageGroup)) {
      return filters.ageGroup;
    }
    // Fallback if filters.ageGroup is somehow invalid and list has items
    if (currentAvailableAgeGroupsList.length > 0) {
      return currentAvailableAgeGroupsList[0];
    }
    return filters.ageGroup || ""; // Default to current or empty if list is empty
  }, [filters.ageGroup, currentAvailableAgeGroupsList]);

  const getAgeGroupDisplayText = (ageGroup: AgeGroup | undefined) => {
    if (!ageGroup) return "";
    // Simple display: capitalize first letter if not a 'u' category like 'u13'
    if (
      ageGroup.startsWith("u") &&
      ageGroup.length > 1 &&
      !isNaN(Number(ageGroup.substring(1, 3)))
    ) {
      return ageGroup.toUpperCase().replace("U", "U"); // e.g. U13, U15
    }
    return ageGroup.charAt(0).toUpperCase() + ageGroup.slice(1);
  };

  const getFilterDisplayText = () => {
    const fed = filters.federation || "N/A";
    const gen = filters.gender === "Men" ? "Men" : "Women";
    const age = getAgeGroupDisplayText(displayAgeGroup) || "N/A";
    return `${fed} • ${gen} • ${age}`;
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
          title: `Records`,
          headerBackTitle: "Back",
          headerShown: true,
          gestureEnabled: true,
          gestureDirection: "horizontal",
          animation: "slide_from_right",
          headerStyle: {
            backgroundColor: colors.background,
          },
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
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={() => {
              // tempFilters will be synced by useEffect [showFilterModal]
              setExpandedSection(null);
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
            <ThemedText style={styles.headerCell}>Snatch</ThemedText>
            <ThemedText style={styles.headerCell}>C&J</ThemedText>
            <ThemedText style={styles.headerCell}>Total</ThemedText>
          </View>

          {loading && (
            <ThemedText style={styles.loadingText}>Loading...</ThemedText>
          )}
          {fetchError && (
            <ThemedText style={styles.errorText}>{fetchError}</ThemedText>
          )}
          {!loading &&
            !fetchError &&
            (!recordsData[displayAgeGroup] ||
              recordsData[displayAgeGroup]?.[filters.gender]?.length === 0) && (
              <ThemedText
                style={{
                  textAlign: "center",
                  marginTop: 16,
                  color: colors.secondaryText,
                }}
              >
                No {filters.federation} records available for{" "}
                {filters.gender === "Men" ? "men" : "women"}
                in the {getAgeGroupDisplayText(displayAgeGroup) ||
                  "selected"}{" "}
                age group.
              </ThemedText>
            )}
          {!loading &&
            !fetchError &&
            recordsData[displayAgeGroup]?.[filters.gender]?.length > 0 &&
            recordsData[displayAgeGroup][filters.gender].map(
              (record: WeightClassRecord, index: number) => (
                <View
                  key={`${filters.federation}-${displayAgeGroup}-${filters.gender}-${record.weightClass}-${index}`} // Added index for more unique key
                  style={[
                    styles.row,
                    index <
                      recordsData[displayAgeGroup][filters.gender].length -
                        1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.border,
                    },
                  ]}
                >
                  <ThemedText style={[styles.cell, { flex: 2 }]}>
                    {record.weightClass}
                  </ThemedText>
                  <ThemedText style={styles.cell}>
                    {record.snatchRecord}
                    kg
                  </ThemedText>
                  <ThemedText style={styles.cell}>
                    {record.cjRecord}
                    kg
                  </ThemedText>
                  <ThemedText style={styles.cell}>
                    {record.totalRecord}
                    kg
                  </ThemedText>
                </View>
              ),
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
            { backgroundColor: colors.modalBackground },
          ]}
          onPress={() => {
            setExpandedSection(null);
            setShowFilterModal(false);
          }}
        >
          <View
            style={[
              styles.modalContent,
              {
                backgroundColor: colors.card,
                maxHeight: windowHeight * 0.8,
              },
            ]}
          >
            <Pressable onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalScrollContent}>
                <ScrollView bounces={false}>
                  {/* Federation Section */}
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
                          expandedSection === "federation"
                            ? null
                            : "federation",
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
                            Federation
                          </ThemedText>
                          <ThemedText
                            style={[
                              styles.filterSectionValue,
                              { color: colors.text },
                            ]}
                          >
                            {tempFilters.federation || "Select..."}
                          </ThemedText>
                        </View>
                        <IconSymbol
                          name={
                            expandedSection === "federation"
                              ? "chevron.down"
                              : "chevron.right"
                          }
                          size={16}
                          color={colors.secondaryText}
                        />
                      </View>
                    </Pressable>
                    {expandedSection === "federation" && (
                      <ScrollView
                        style={[
                          styles.filterOptions,
                          { borderTopColor: colors.border },
                        ]}
                        bounces={false}
                      >
                        {availableFederations.map((federation) => (
                          <Pressable
                            key={federation}
                            style={({ pressed }) => [
                              styles.filterOption,
                              { borderBottomColor: colors.border },
                              tempFilters.federation === federation && {
                                backgroundColor: colors.pressed,
                              },
                              pressed && { opacity: 0.8 },
                            ]}
                            onPress={() => {
                              // When federation changes in modal, tempFilters.federation is set.
                              // The useEffect for [showFilterModal, tempFilters.federation, modalFederationForAgeGroups]
                              // will handle fetching new age groups and resetting tempFilters.ageGroup.
                              setTempFilters((prev) => ({
                                ...prev,
                                federation:
                                  federation /* ageGroup will be reset by effect */,
                              }));
                              setExpandedSection(null);
                            }}
                          >
                            <ThemedText
                              style={[
                                styles.filterOptionText,
                                { color: colors.text },
                                tempFilters.federation === federation && {
                                  color: colors.link,
                                },
                              ]}
                            >
                              {federation}
                            </ThemedText>
                            {tempFilters.federation === federation && (
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

                  {/* Gender Section */}
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
                            {tempFilters.gender === "Men" ? "Men" : "Women"}
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
                              setTempFilters((prev) => ({
                                ...prev,
                                gender: gender,
                              }));
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
                              {gender === "Men" ? "Men" : "Women"}
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

                  {/* Age Group Section */}
                  <View style={styles.filterSection}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.filterSectionButton,
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() => {
                        // Ensure age groups are loaded for tempFilters.federation if not already
                        if (!tempFilters.federation) {
                          // Maybe show a message to select federation first
                          return;
                        }
                        // The useEffect for tempFilters.federation should have loaded these.
                        // If not, it indicates a potential logic issue or race condition.
                        setExpandedSection(
                          expandedSection === "ageGroup" ? null : "ageGroup",
                        );
                      }}
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
                            {getAgeGroupDisplayText(tempFilters.ageGroup) ||
                              (tempFilters.federation
                                ? "Select..."
                                : "Select Federation First")}
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
                    {expandedSection === "ageGroup" &&
                      tempFilters.federation && (
                        <ScrollView
                          style={[
                            styles.filterOptions,
                            {
                              maxHeight: maxOptionsHeight,
                              borderTopColor: colors.border,
                            },
                          ]}
                          bounces={false}
                        >
                          {currentAvailableAgeGroupsList.length === 0 && (
                            <ThemedText
                              style={{
                                padding: 16,
                                color: colors.secondaryText,
                              }}
                            >
                              Loading age groups...
                            </ThemedText>
                          )}
                          {currentAvailableAgeGroupsList.map((ageGroup) => (
                            <Pressable
                              key={ageGroup}
                              style={({ pressed }) => [
                                styles.filterOption,
                                { borderBottomColor: colors.border },
                                tempFilters.ageGroup === ageGroup && {
                                  backgroundColor: colors.pressed,
                                },
                                pressed && { opacity: 0.8 },
                              ]}
                              onPress={() => {
                                setTempFilters((prev) => ({
                                  ...prev,
                                  ageGroup: ageGroup,
                                }));
                                setExpandedSection(null);
                              }}
                            >
                              <ThemedText
                                style={[
                                  styles.filterOptionText,
                                  { color: colors.text },
                                  tempFilters.ageGroup === ageGroup && {
                                    color: colors.link,
                                  },
                                ]}
                              >
                                {getAgeGroupDisplayText(ageGroup)}
                              </ThemedText>
                              {tempFilters.ageGroup === ageGroup && (
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
    backgroundColor: "#F5F5F5",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#C6C6C8",
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
  errorText: {
    color: "red",
    textAlign: "center",
    marginTop: 16,
  },
  loadingText: {
    textAlign: "center",
    marginTop: 16,
  },
});
