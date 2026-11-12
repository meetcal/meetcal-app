import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";

export function SlideContent({
  children,
  active,
}: {
  children: React.ReactNode;
  active: boolean;
}) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(40);

  useEffect(() => {
    if (active) {
      opacity.value = withDelay(200, withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) }));
      translateY.value = withDelay(200, withSpring(0, { damping: 20, stiffness: 90 }));
    } else {
      opacity.value = 0;
      translateY.value = 40;
    }
  }, [active, opacity, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={[styles.slideContentInner, animStyle]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  slideContentInner: {
    flex: 1,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
});
