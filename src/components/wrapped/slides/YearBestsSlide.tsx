import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { AnimatedCounter } from "@/components/wrapped/AnimatedCounter";
import { wrappedStyles } from "@/components/wrapped/wrapped-styles";
import { Palette, WhiteAlpha } from "@/constants/Palette";
import type { WrappedStats } from "@/types/wrapped";

export function YearBestsSlide({ stats, year, active }: { stats: WrappedStats; year: number; active: boolean }) {
  return (
    <View style={wrappedStyles.slideInner}>
      <Text style={wrappedStyles.slideTopLabel}>{`BEST OF ${year}`}</Text>
      <View style={styles.prCenter}>
        <View style={styles.prCard}>
          <Text style={styles.prLabel}>SNATCH</Text>
          {active ? (
            <AnimatedCounter
              value={stats.bestSnatch} delay={300} suffix="kg"
              style={styles.prValue}
            />
          ) : (
            <Text style={styles.prValue}>0kg</Text>
          )}
        </View>
        <View style={[styles.prCard, styles.prCardLarge]}>
          <Text style={styles.prLabelLarge}>BEST TOTAL</Text>
          {active ? (
            <AnimatedCounter
              value={stats.bestTotal} delay={600} suffix="kg"
              style={styles.prValueLarge}
            />
          ) : (
            <Text style={styles.prValueLarge}>0kg</Text>
          )}
        </View>
        <View style={styles.prCard}>
          <Text style={styles.prLabel}>CLEAN & JERK</Text>
          {active ? (
            <AnimatedCounter
              value={stats.bestCleanJerk} delay={900} suffix="kg"
              style={styles.prValue}
            />
          ) : (
            <Text style={styles.prValue}>0kg</Text>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  prCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    gap: 16,
  },
  prCard: {
    backgroundColor: WhiteAlpha[10],
    borderRadius: 20,
    padding: 24,
    width: "100%",
    alignItems: "center",
    borderWidth: 1,
    borderColor: WhiteAlpha[10],
  },
  prCardLarge: {
    backgroundColor: WhiteAlpha[18],
    borderColor: WhiteAlpha[25],
    paddingVertical: 32,
  },
  prLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: WhiteAlpha[50],
    letterSpacing: 3,
    marginBottom: 6,
  },
  prValue: {
    fontSize: 40,
    fontWeight: "900",
    color: Palette.white,
  },
  prLabelLarge: {
    fontSize: 14,
    fontWeight: "700",
    color: WhiteAlpha[60],
    letterSpacing: 3,
    marginBottom: 8,
  },
  prValueLarge: {
    fontSize: 56,
    fontWeight: "900",
    color: Palette.white,
  },
});
