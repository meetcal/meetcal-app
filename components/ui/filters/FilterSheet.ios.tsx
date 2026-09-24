import { useAppColors } from "@/hooks/useAppColors";
import React from "react";
import { Modal, StyleSheet, View } from "react-native";
import type { FilterSheetProps } from "./FilterSheet";

/**
 * iOS filter sheet: a native `pageSheet`, so UIKit owns swipe-to-dismiss
 * (including pulling down from the top of the scroll body) and reports it
 * through `onRequestClose`. On iPhone Duo's wide inner display UIKit shows it
 * as a centered form sheet instead of a full-width slab.
 */
const FilterSheet: React.FC<FilterSheetProps> = ({
  visible,
  onClose,
  header,
  children,
}) => {
  const colors = useAppColors();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.sheetContent, { backgroundColor: colors.card }]}>
        <View style={styles.handleContainer}>
          <View
            style={[styles.handle, { backgroundColor: colors.borderBottom }]}
          />
        </View>
        {header}
        {children}
      </View>
    </Modal>
  );
};

export default FilterSheet;

const styles = StyleSheet.create({
  sheetContent: {
    flex: 1,
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
});
