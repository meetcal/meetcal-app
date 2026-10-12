import { useTheme } from "@/contexts/ThemeContext";
import { PageIndicatorProps } from "@/types/schedule";
import { useEffect } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Palette } from "@/constants/Palette";

const INACTIVE_COLOR = "#5A9AD4";
const ACTIVE_COLOR = "#007AFF";

function Dot({ active, activeShadow }: { active: boolean; activeShadow: string }) {
  const progress = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    progress.value = withSpring(active ? 1 : 0, {
      damping: 15,
      stiffness: 200,
    });
  }, [active, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: interpolate(progress.value, [0, 1], [6, 18]),
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [INACTIVE_COLOR, ACTIVE_COLOR],
    ),
  }));

  return (
    <Animated.View
      style={[
        styles.dot,
        active && styles.activeDot,
        { shadowColor: active ? activeShadow : Palette.transparent },
        animatedStyle,
      ]}
    />
  );
}

export function PageIndicator({
  count,
  currentPage,
  onPageChange,
}: PageIndicatorProps) {
  const { currentTheme } = useTheme();
  const insets = useSafeAreaInsets();

  const containerBackground =
    currentTheme === "dark" ? "rgba(58,58,60,0.65)" : "rgba(0,0,0,0.08)";
  const containerBorder =
    currentTheme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
  const activeDotShadow =
    currentTheme === "dark" ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.2)";

  // Screen readers get one adjustable control, like a native page control:
  // "Page 2 of 5", swipe up or down to change day. The dots are too small
  // and too close together to be useful targets one by one.
  const goTo = (page: number) => {
    if (page >= 0 && page < count) onPageChange?.(page);
  };

  return (
    <View
      style={[
        styles.container,
        {
          bottom:
            Platform.OS === "ios" ? insets.bottom + 5 : insets.bottom + 60,
        },
      ]}
    >
      <View
        style={[
          styles.dotsContainer,
          {
            backgroundColor: containerBackground,
            borderColor: containerBorder,
          },
        ]}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Day"
        accessibilityValue={{ text: `Page ${currentPage + 1} of ${count}` }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "increment") goTo(currentPage + 1);
          if (event.nativeEvent.actionName === "decrement") goTo(currentPage - 1);
        }}
      >
        {Array.from({ length: count }).map((_, index) => (
          <Pressable
            key={index}
            onPress={() => onPageChange?.(index)}
            // 44pt tall. Sideways the dots are 13pt apart, so a wider slop
            // would steal taps from the neighbouring dot.
            hitSlop={{ top: 19, bottom: 19, left: 3, right: 3 }}
          >
            <Dot active={index === currentPage} activeShadow={activeDotShadow} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 12,
    zIndex: 2,
  },
  dotsContainer: {
    flexDirection: "row",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: Palette.shadow,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  dot: {
    height: 6,
    borderRadius: 999,
  },
  activeDot: {
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 3,
  },
});
