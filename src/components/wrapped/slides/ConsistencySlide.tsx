import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { AnimatedCounter } from "@/components/wrapped/AnimatedCounter";
import { wrappedStyles } from "@/components/wrapped/wrapped-styles";
import { Palette, WhiteAlpha } from "@/constants/Palette";
import { accuracyTier } from "@/lib/wrapped-slide-copy";
import type { WrappedStats } from "@/types/wrapped";

const RING_SIZE = 220;

export function ConsistencySlide({ stats, active }: { stats: WrappedStats; active: boolean }) {
  const percentage = stats.makePercentage;

  return (
    <View style={wrappedStyles.slideInner}>
      <Text style={wrappedStyles.slideTopLabel}>CONSISTENCY</Text>
      <View style={styles.consistencyCenter}>
        <View style={[styles.ringContainer, { width: RING_SIZE, height: RING_SIZE }]}>
          <View style={styles.ringInner}>
            <View style={styles.ringValueRow}>
              {active ? (
                <AnimatedCounter
                  value={percentage}
                  decimals={1}
                  delay={500}
                  style={styles.ringPercentage}
                />
              ) : (
                <Text style={styles.ringPercentage}>0</Text>
              )}
              <Text style={styles.ringPercent}>%</Text>
            </View>
            <Text style={styles.ringLabel}>MAKE RATE</Text>
          </View>
        </View>

        <View style={styles.consistencyStatsRow}>
          <View style={styles.consistencyStat}>
            {active ? (
              <AnimatedCounter value={stats.consecutiveMakes} delay={800} style={styles.consistencyStatNumber} />
            ) : (
              <Text style={styles.consistencyStatNumber}>0</Text>
            )}
            <Text style={styles.consistencyStatLabel}>
CONSECUTIVE
{"\n"}
MAKES
</Text>
          </View>
          <View style={styles.consistencyStatDivider} />
          <View style={styles.consistencyStat}>
            <Text style={styles.consistencyStatNumber}>
              {accuracyTier(percentage)}
            </Text>
            <Text style={styles.consistencyStatLabel}>
ACCURACY
{"\n"}
TIER
</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  consistencyCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 40,
  },
  ringContainer: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 120,
    borderWidth: 10,
    borderColor: WhiteAlpha[10],
  },
  ringInner: {
    alignItems: "center",
    justifyContent: "center",
  },
  ringValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  ringPercentage: {
    fontSize: 44,
    fontWeight: "900",
    color: Palette.white,
  },
  ringPercent: {
    fontSize: 24,
    fontWeight: "800",
    color: WhiteAlpha[70],
    marginLeft: 2,
  },
  ringLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: WhiteAlpha[50],
    letterSpacing: 3,
    marginTop: 2,
  },
  consistencyStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 24,
  },
  consistencyStat: {
    alignItems: "center",
    minWidth: 100,
  },
  consistencyStatNumber: {
    fontSize: 32,
    fontWeight: "900",
    color: Palette.white,
    marginBottom: 4,
  },
  consistencyStatLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: WhiteAlpha[50],
    letterSpacing: 2,
    textAlign: "center",
    lineHeight: 16,
  },
  consistencyStatDivider: {
    width: 1,
    height: 48,
    backgroundColor: WhiteAlpha[20],
  },
});
