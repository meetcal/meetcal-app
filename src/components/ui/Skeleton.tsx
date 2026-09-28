import { useAppColors } from "@/hooks/useAppColors";
import { useEffect, useRef } from "react";
import {
  Animated,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";

const PULSE_MIN = 0.4;
const PULSE_MAX = 0.9;
const PULSE_DURATION = 900;

/**
 * Owns the shared opacity-pulse loop (0.4 <-> 0.9) used by the app's
 * skeleton loaders. Returns an Animated.Value that can be shared across many
 * SkeletonBlock instances so they pulse in sync.
 */
export function useSkeletonPulse(): Animated.Value {
  const pulse = useRef(new Animated.Value(PULSE_MIN)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: PULSE_MAX,
          duration: PULSE_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: PULSE_MIN,
          duration: PULSE_DURATION,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return pulse;
}

export type SkeletonBlockProps = {
  style?: StyleProp<ViewStyle>;
  /** Fill color of the block. Defaults to the themed card color. */
  color?: string;
  /**
   * The pulse value to share. Required so every block in one skeleton pulses
   * in sync off a single `useSkeletonPulse()` loop; a per-block fallback loop
   * used to exist here but no call site ever omitted `pulse`.
   */
  pulse: Animated.Value;
};

export function SkeletonBlock({ style, color, pulse }: SkeletonBlockProps) {
  const colors = useAppColors();

  return (
    <Animated.View
      style={[
        styles.block,
        { backgroundColor: color ?? colors.card, opacity: pulse },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  block: {
    borderRadius: 6,
  },
});
