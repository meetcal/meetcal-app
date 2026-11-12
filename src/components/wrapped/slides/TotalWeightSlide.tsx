import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AnimatedCounter } from "@/components/wrapped/AnimatedCounter";
import { wrappedStyles } from "@/components/wrapped/wrapped-styles";
import { BlackAlpha, Palette, WhiteAlpha } from "@/constants/Palette";
import { pickFunFact } from "@/lib/wrapped-slide-copy";
import type { WrappedStats } from "@/types/wrapped";

export function TotalWeightSlide({ stats, active }: { stats: WrappedStats; active: boolean }) {
  const funFact = useMemo(() => pickFunFact(stats.totalWeightLifted), [stats.totalWeightLifted]);

  return (
    <View style={wrappedStyles.slideInner}>
      <Text style={wrappedStyles.slideTopLabel}>TOTAL WEIGHT LIFTED</Text>
      <View style={styles.heroStatCenter}>
        <Text style={styles.heroStatPrefix}>YOU LIFTED</Text>
        {active ? (
          <AnimatedCounter
            value={stats.totalWeightLifted}
            duration={2000}
            delay={400}
            style={styles.heroStatNumber}
          />
        ) : (
          <Text style={styles.heroStatNumber}>0</Text>
        )}
        <Text style={styles.heroStatSuffix}>KILOGRAMS</Text>
        <View style={styles.funFactCard}>
          <Text style={styles.funFactText}>{funFact}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heroStatCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  heroStatPrefix: {
    fontSize: 16,
    fontWeight: "700",
    color: WhiteAlpha[50],
    letterSpacing: 4,
    marginBottom: 8,
  },
  heroStatNumber: {
    fontSize: 72,
    fontWeight: "900",
    color: Palette.white,
    textAlign: "center",
    lineHeight: 80,
  },
  heroStatSuffix: {
    fontSize: 28,
    fontWeight: "800",
    color: WhiteAlpha[70],
    letterSpacing: 8,
    marginTop: 4,
  },
  funFactCard: {
    backgroundColor: BlackAlpha[25],
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 16,
    marginTop: 32,
  },
  funFactText: {
    fontSize: 15,
    fontWeight: "600",
    color: WhiteAlpha[80],
    textAlign: "center",
  },
});
