import { ThemedText } from "@/components/ui/ThemedText";
import { useAppColors } from "@/hooks/useAppColors";
import { getChevronIcon } from "@/lib/start-list-utils";
import React, { useState } from "react";
import {
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import FilterModalOptions from "./FilterModalOptions";
import FilterModalTitle from "./FilterModalTitle";

export interface FilterOption {
  value: string;
  label: string;
  icon?: string;
  iconColor?: string;
}

export interface FilterSection {
  id: string;
  title: string;
  options: FilterOption[];
  allOptionLabel?: string;
  customContent?:
    | React.ReactNode
    | ((context: {
        tempFilters: Record<string, string>;
        setTempFilters: React.Dispatch<
          React.SetStateAction<Record<string, string>>
        >;
        collapseSection: () => void;
      }) => React.ReactNode);
  dependsOn?: string[]; // IDs of filters that, when changed, should reset this filter to first option
}

interface GenericFilterModalProps {
  visible: boolean;
  onClose: () => void;
  sections:
    | FilterSection[]
    | ((tempFilters: Record<string, string>) => FilterSection[]);
  filters: Record<string, string>;
  onApplyFilters: (filters: Record<string, string>) => void;
  onResetFilters: () => void;
  resultCount?: number | ((tempFilters: Record<string, string>) => number);
  resultLabel?: string;
}

const GenericFilterModal: React.FC<GenericFilterModalProps> = ({
  visible,
  onClose,
  sections,
  filters,
  onApplyFilters,
  onResetFilters,
  resultCount,
  resultLabel = "results",
}) => {
  const colors = useAppColors();
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [tempFilters, setTempFilters] = useState<Record<string, string>>({});
  const prevTempFiltersRef = React.useRef<Record<string, string>>({});
  const pendingDependencyResetRef = React.useRef<Record<string, boolean>>({});

  const windowHeight = Dimensions.get("window").height;
  const maxOptionsHeight = windowHeight * 0.4;

  // Initialize temp filters when modal opens (only on visibility change)
  React.useEffect(() => {
    if (visible) {
      setTempFilters(filters);
      prevTempFiltersRef.current = { ...filters };
      pendingDependencyResetRef.current = {};
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Get current sections (either static or dynamically generated)
  const currentSections =
    typeof sections === "function" ? sections(tempFilters) : sections;

  // Auto-update dependent filters when their options change OR when dependencies change
  React.useEffect(() => {
    if (!visible) return;

    const updates: Record<string, string> = {};

    currentSections.forEach((section) => {
      const currentValue = tempFilters[section.id];
      const firstOptionValue = section.options[0]?.value || "";
      const shouldValidateAgainstOptions =
        section.options.length > 0 || !section.customContent;

      if (section.dependsOn && section.dependsOn.length > 0) {
        const dependencyChanged = section.dependsOn.some(
          (depId) => prevTempFiltersRef.current[depId] !== tempFilters[depId],
        );

        if (dependencyChanged) {
          if (firstOptionValue) {
            if (currentValue !== firstOptionValue) {
              updates[section.id] = firstOptionValue;
            }
            pendingDependencyResetRef.current[section.id] = false;
          } else {
            pendingDependencyResetRef.current[section.id] = true;
          }
        } else if (
          pendingDependencyResetRef.current[section.id] &&
          firstOptionValue
        ) {
          if (currentValue !== firstOptionValue) {
            updates[section.id] = firstOptionValue;
          }
          pendingDependencyResetRef.current[section.id] = false;
        }
      }

      if (
        shouldValidateAgainstOptions &&
        currentValue &&
        !section.options.some((opt) => opt.value === currentValue)
      ) {
        updates[section.id] = firstOptionValue;
      }
    });

    if (Object.keys(updates).length > 0) {
      setTempFilters((prev) => ({ ...prev, ...updates }));
    }

    // Update ref with current values
    prevTempFiltersRef.current = { ...tempFilters };
  }, [currentSections, tempFilters, visible]);

  const handleApply = () => {
    onApplyFilters(tempFilters);
    setExpandedSection(null);
    onClose();
  };

  const handleReset = () => {
    const resetFilters: Record<string, string> = {};
    currentSections.forEach((section) => {
      resetFilters[section.id] = section.options[0]?.value || "";
    });
    setTempFilters(resetFilters);
    prevTempFiltersRef.current = { ...resetFilters };
    onResetFilters();
  };

  const handleClose = () => {
    setExpandedSection(null);
    onClose();
  };

  const resolvedResultCount =
    typeof resultCount === "function" ? resultCount(tempFilters) : resultCount;

  const getDisplayValue = (section: FilterSection) => {
    const value = tempFilters[section.id] || "";
    if (!value) {
      return section.allOptionLabel || "All";
    }
    const option = section.options.find((opt) => opt.value === value);
    return option?.label || value;
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={handleClose}
    >
      <Pressable
        style={[
          styles.modalOverlay,
          { backgroundColor: colors.modalBackground },
        ]}
        onPress={handleClose}
      >
        <Pressable
          style={[
            styles.modalContent,
            {
              backgroundColor: colors.card,
              maxHeight: windowHeight * 0.8,
            },
          ]}
          onPress={() => {}}
        >
          <View style={styles.modalScrollContent}>
            <ScrollView bounces={false}>
              {currentSections.map((section) => (
                <View
                  key={section.id}
                  style={[
                    styles.filterSection,
                    { borderBottomColor: colors.border },
                  ]}
                >
                  <FilterModalTitle
                    title={section.title}
                    value={getDisplayValue(section)}
                    onPress={() =>
                      setExpandedSection(
                        expandedSection === section.id ? null : section.id,
                      )
                    }
                    icon={getChevronIcon(
                      expandedSection === section.id ? "down" : "right",
                    )}
                  />

                  {expandedSection === section.id &&
                    (section.customContent ? (
                      typeof section.customContent === "function" ? (
                        section.customContent({
                          tempFilters,
                          setTempFilters,
                          collapseSection: () => setExpandedSection(null),
                        })
                      ) : (
                        section.customContent
                      )
                    ) : (
                      <FilterModalOptions
                        options={section.options}
                        selectedValue={tempFilters[section.id] || ""}
                        onSelect={(value) => {
                          setTempFilters((prev) => ({
                            ...prev,
                            [section.id]: value,
                          }));
                          setExpandedSection(null);
                        }}
                        maxHeight={maxOptionsHeight}
                        allOptionLabel={section.allOptionLabel}
                      />
                    ))}
                </View>
              ))}
            </ScrollView>
          </View>

          <View style={[styles.modalFooter, { borderTopColor: colors.border }]}>
            <View style={styles.modalFooterContent}>
              <View style={styles.modalFooterRight}>
                {resolvedResultCount !== undefined && (
                  <ThemedText
                    style={[
                      styles.resultCount,
                      { color: colors.secondaryText },
                    ]}
                  >
                    {resolvedResultCount} {resultLabel}
                  </ThemedText>
                )}
                <Pressable
                  style={({ pressed }) => [
                    styles.resetButton,
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={handleReset}
                >
                  <ThemedText style={styles.resetButtonText}>Reset</ThemedText>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.applyButton,
                    { backgroundColor: colors.link },
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={handleApply}
                >
                  <ThemedText style={styles.applyButtonText}>Apply</ThemedText>
                </Pressable>
              </View>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

export default GenericFilterModal;

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
  },
  modalContent: {
    borderRadius: 12,
    overflow: "hidden",
    marginHorizontal: 16,
    maxHeight: "80%",
  },
  modalScrollContent: {
    flexGrow: 1,
  },
  filterSection: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalFooter: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  modalFooterContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  modalFooterRight: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },
  resetButton: {
    backgroundColor: "#FF3B30",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  resetButtonText: {
    fontSize: 17,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  resultCount: {
    fontSize: 15,
    marginRight: "auto",
  },
  applyButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
  },
  applyButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
});
