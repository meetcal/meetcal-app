import { useAppColors } from "@/hooks/useAppColors";
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
import { isMaestroE2E } from "@/lib/e2e";
import { pageIndicatorBottom, usesNativeTabs } from "@/lib/tab-bar-layout";

const INACTIVE_COLOR = "#5A9AD4";
const ACTIVE_COLOR = "#007AFF";
/**
 * Each dot's real touch height. hitSlop cannot supply it: Android ignores
 * slop that reaches past the parent's bounds, and the pill is only 22pt tall.
 */
const DOT_TOUCH_HEIGHT = 44;
/** The visible pill: a 6pt dot with 8pt above and below. */
const PILL_HEIGHT = 22;

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
  const colors = useAppColors();
  const insets = useSafeAreaInsets();

  const containerBackground = colors.pageIndicatorFill;
  const containerBorder = colors.pageIndicatorBorder;
  const activeDotShadow = colors.pageIndicatorDotShadow;

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
          // Above the tab bar on both paths: the JS bar (Android, iOS
          // 18-25) is not part of the inset, UIKit's native one is.
          bottom: pageIndicatorBottom(
            insets.bottom,
            usesNativeTabs(Platform.OS, Platform.Version, isMaestroE2E()),
          ),
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
            testID={`page-dot-${index}`}
            onPress={() => onPageChange?.(index)}
            style={styles.dotTarget}
            // Sideways the dots are 13pt apart, so a wider slop would steal
            // taps from the neighbouring dot. 3pt stays inside the pill's
            // horizontal padding.
            hitSlop={{ left: 3, right: 3 }}
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
    alignItems: "center",
    paddingHorizontal: 12,
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
  dotTarget: {
    // A real 44pt target that overhangs the 22pt pill by 11pt above and
    // below. The negative margin keeps the pill at its drawn size, and the
    // overhang stays inside the container's 12pt padding. Touches outside a
    // parent's bounds reach a child that is laid out there (overflow is
    // visible), unlike hitSlop.
    height: DOT_TOUCH_HEIGHT,
    marginVertical: -(DOT_TOUCH_HEIGHT - PILL_HEIGHT) / 2,
    justifyContent: "center",
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
