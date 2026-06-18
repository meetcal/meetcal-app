import { ThemedText } from "@/components/ui/ThemedText";
import { useAppColors } from "@/hooks/useAppColors";
import { getChevronIcon } from "@/lib/start-list-utils";
import React, { useCallback, useRef, useState } from "react";
import {
  LayoutChangeEvent,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FilterChipGroup from "./FilterChipGroup";
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
  displayMode?: "chips" | "accordion";
  dependsOn?: string[];
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
  footerBottomInset?: number;
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
  footerBottomInset,
}) => {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [tempFilters, setTempFilters] = useState<Record<string, string>>({});
  const prevTempFiltersRef = useRef<Record<string, string>>({});
  const pendingDependencyResetRef = useRef<Record<string, boolean>>({});
  const scrollViewRef = useRef<ScrollView>(null);
  const sectionLayoutsRef = useRef<Record<string, number>>({});

  const { height: windowHeight } = useWindowDimensions();
  const sheetTopOffset = insets.top + 10;
  const maxOptionsHeight = windowHeight * 0.3;

  React.useEffect(() => {
    if (visible) {
      setTempFilters(filters);
      prevTempFiltersRef.current = { ...filters };
      pendingDependencyResetRef.current = {};
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const currentSections =
    typeof sections === "function" ? sections(tempFilters) : sections;

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

    prevTempFiltersRef.current = { ...tempFilters };
  }, [currentSections, tempFilters, visible]);

  const handleSectionLayout = useCallback(
    (sectionId: string, event: LayoutChangeEvent) => {
      sectionLayoutsRef.current[sectionId] = event.nativeEvent.layout.y;
    },
    [],
  );

  const handleExpandSection = useCallback(
    (sectionId: string) => {
      const isCollapsing = expandedSection === sectionId;
      setExpandedSection(isCollapsing ? null : sectionId);

      if (!isCollapsing) {
        requestAnimationFrame(() => {
          const y = sectionLayoutsRef.current[sectionId];
          if (y !== undefined) {
            scrollViewRef.current?.scrollTo({ y, animated: false });
          }
        });
      }
    },
    [expandedSection],
  );

  const handleApply = () => {
    onApplyFilters(tempFilters);
    setExpandedSection(null);
    onClose();
  };

  const handleReset = () => {
    const resetFilters = Object.keys(filters).reduce<Record<string, string>>(
      (acc, key) => {
        acc[key] = "";
        return acc;
      },
      {},
    );
    setTempFilters(resetFilters);
    prevTempFiltersRef.current = { ...resetFilters };
    pendingDependencyResetRef.current = {};
    setExpandedSection(null);
    onResetFilters();
    onClose();
  };

  const handleClose = () => {
    setExpandedSection(null);
    onClose();
  };

  const resolvedResultCount =
    typeof resultCount === "function" ? resultCount(tempFilters) : resultCount;
  const resolvedFooterBottomInset = footerBottomInset ?? insets.bottom;

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
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={styles.sheetWrapper}>
        <Pressable style={styles.sheetBackdrop} onPress={handleClose} />
        <View
          style={[
            styles.sheetContent,
            {
              backgroundColor: colors.card,
              top: sheetTopOffset,
              height: windowHeight - sheetTopOffset,
            },
          ]}
        >
          <View style={styles.handleContainer}>
            <View
              style={[styles.handle, { backgroundColor: colors.borderBottom }]}
            />
          </View>

          <ScrollView
            ref={scrollViewRef}
            bounces={false}
            showsVerticalScrollIndicator={false}
            scrollEnabled={expandedSection === null}
          >
            {currentSections.map((section) => (
              <View
                key={section.id}
                onLayout={(e) => handleSectionLayout(section.id, e)}
                style={[
                  styles.filterSection,
                  { borderBottomColor: colors.border },
                ]}
              >
                {section.displayMode === "chips" ? (
                  <FilterChipGroup
                    title={section.title}
                    options={section.options}
                    selectedValue={tempFilters[section.id] || ""}
                    onSelect={(value) => {
                      setTempFilters((prev) => ({
                        ...prev,
                        [section.id]: value,
                      }));
                    }}
                    allOptionLabel={section.allOptionLabel}
                  />
                ) : (
                  <>
                    <FilterModalTitle
                      title={section.title}
                      value={getDisplayValue(section)}
                      onPress={() => handleExpandSection(section.id)}
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
                  </>
                )}
              </View>
            ))}
          </ScrollView>

          <View
            style={[
              styles.footer,
              {
                borderTopColor: colors.border,
                paddingBottom: 16 + resolvedFooterBottomInset,
              },
            ]}
          >
            <View style={styles.footerContent}>
              {resolvedResultCount !== undefined && (
                <ThemedText
                  style={[styles.resultCount, { color: colors.secondaryText }]}
                >
                  {`${resolvedResultCount} ${resultLabel}`}
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
      </View>
    </Modal>
  );
};

export default GenericFilterModal;

const styles = StyleSheet.create({
  sheetWrapper: {
    flex: 1,
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheetContent: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
  },
  handleContainer: {
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 4,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  filterSection: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  footer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  footerContent: {
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
