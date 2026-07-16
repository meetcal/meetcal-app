import { useAppColors } from "@/hooks/useAppColors";
import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

/**
 * A slim rounded progress bar that animates once, on mount, to `rate` (0-100).
 * Used for the snatch / C&J make-rate summary. SVG-free so it stays cheap.
 */
export function RateBar({ rate, color }: { rate: number; color: string }) {
  const colors = useAppColors();
  const progress = useSharedValue(0);
  const hasAnimatedRef = useRef(false);

  useEffect(() => {
    const clamped = Math.max(0, Math.min(100, rate));
    if (hasAnimatedRef.current) {
      // Data refresh (e.g. cached results replaced by full history):
      // update without replaying the fill animation.
      progress.value = clamped;
    } else {
      hasAnimatedRef.current = true;
      progress.value = withTiming(clamped, { duration: 400 });
    }
  }, [rate, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: `${progress.value}%`,
  }));

  return (
    <View style={[styles.track, { backgroundColor: colors.border }]}>
      <Animated.View
        style={[styles.fill, { backgroundColor: color }, animatedStyle]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    width: "100%",
  },
  fill: {
    height: "100%",
    borderRadius: 3,
  },
});
