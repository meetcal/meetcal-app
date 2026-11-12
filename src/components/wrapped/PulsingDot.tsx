import React, { useEffect } from "react";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { Palette, WhiteAlpha } from "@/constants/Palette";

export const SLIDE_DOT_SIZE = 8;
const ACTIVE_DOT_WIDTH = 24;

export function PulsingDot({ active }: { active: boolean }) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (active) {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.3, { duration: 600 }),
          withTiming(1, { duration: 600 }),
        ),
        -1,
        true,
      );
    } else {
      scale.value = withTiming(1, { duration: 200 });
    }
  }, [active, scale]);

  const width = active ? ACTIVE_DOT_WIDTH : SLIDE_DOT_SIZE;
  const backgroundColor = active ? Palette.white : WhiteAlpha[40];
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    width,
    height: SLIDE_DOT_SIZE,
    borderRadius: SLIDE_DOT_SIZE / 2,
    backgroundColor,
    marginHorizontal: 3,
  }));

  return <Animated.View style={animStyle} />;
}
