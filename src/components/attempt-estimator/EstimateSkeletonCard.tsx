import { attemptEstimatorStyles as styles } from "@/components/attempt-estimator/attemptEstimatorStyles";
import type { AppColors } from "@/hooks/useAppColors";
import React, { useEffect, useRef } from "react";
import { Animated, View } from "react-native";

export function EstimateSkeletonCard({ colors }: { colors: AppColors }) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View style={[styles.athleteCard, { backgroundColor: colors.card, opacity }]}>
      <View style={styles.athleteHeader}>
        <View style={[styles.skeletonLine, { width: "55%", backgroundColor: colors.border }]} />
        <View style={[styles.skeletonChevron, { backgroundColor: colors.border }]} />
      </View>
    </Animated.View>
  );
}
