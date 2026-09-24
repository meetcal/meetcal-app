import { useAppColors } from "@/hooks/useAppColors";
import React, { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isSheetDrag, shouldDismissSheet } from "./filterSheetGesture";
import { BlackAlpha } from "@/constants/Palette";

export interface FilterSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Chrome above the body. It drags the sheet along with the grabber. */
  header?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Android bottom sheet for the filter modals. There is no native page sheet
 * here, so the grabber (and `header`) drag the sheet down and dismiss it past
 * a distance or velocity threshold. iOS uses `FilterSheet.ios.tsx`.
 */
const FilterSheet: React.FC<FilterSheetProps> = ({
  visible,
  onClose,
  header,
  children,
}) => {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const sheetTopOffset = insets.top + 10;
  const sheetHeight = windowHeight - sheetTopOffset;

  const translateY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // A drag-dismissed sheet is left where the finger released it while the
  // modal slides out; put it back before the next open.
  useEffect(() => {
    if (visible) translateY.setValue(0);
  }, [visible, translateY]);

  const panResponder = useMemo(() => {
    const springBack = () =>
      Animated.spring(translateY, {
        toValue: 0,
        bounciness: 0,
        useNativeDriver: true,
      }).start();

    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => isSheetDrag(g.dx, g.dy),
      onMoveShouldSetPanResponderCapture: (_, g) => isSheetDrag(g.dx, g.dy),
      onPanResponderMove: (_, g) => translateY.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (shouldDismissSheet(g.dy, g.vy, sheetHeight)) {
          onCloseRef.current();
        } else {
          springBack();
        }
      },
      onPanResponderTerminate: springBack,
    });
  }, [sheetHeight, translateY]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.sheetWrapper}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <Animated.View
          style={[
            styles.sheetContent,
            {
              backgroundColor: colors.card,
              top: sheetTopOffset,
              height: sheetHeight,
              transform: [{ translateY }],
            },
          ]}
        >
          <View {...panResponder.panHandlers}>
            <View style={styles.handleContainer}>
              <View
                style={[
                  styles.handle,
                  { backgroundColor: colors.borderBottom },
                ]}
              />
            </View>
            {header}
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
};

export default FilterSheet;

const styles = StyleSheet.create({
  sheetWrapper: {
    flex: 1,
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: BlackAlpha[40],
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
  // Taller than the visible grabber so the drag target is thumb-sized.
  handleContainer: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 10,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
});
