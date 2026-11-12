import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { AnimatedCounter } from "@/components/wrapped/AnimatedCounter";
import { wrappedStyles } from "@/components/wrapped/wrapped-styles";
import { BlackAlpha, Palette, WhiteAlpha, WrappedPalette } from "@/constants/Palette";
import { formatImprovement } from "@/lib/wrapped-stats";
import type { WrappedStats } from "@/types/wrapped";

export function MeetJourneySlide({ stats, year, active }: { stats: WrappedStats; year: number; active: boolean }) {
  const improvementText = formatImprovement(stats.improvementFromFirst);
  const improved = stats.improvementFromFirst !== null && stats.improvementFromFirst > 0;

  return (
    <View style={wrappedStyles.slideInner}>
      <Text style={wrappedStyles.slideTopLabel}>
YOUR
{year}
{' '}
JOURNEY
</Text>
      <View style={styles.journeyCenter}>
        <View style={styles.journeyHero}>
          {active ? (
            <AnimatedCounter value={stats.totalMeets} delay={300} style={styles.journeyHeroNumber} />
          ) : (
            <Text style={styles.journeyHeroNumber}>0</Text>
          )}
          <Text style={styles.journeyHeroLabel}>MEETS COMPETED</Text>
        </View>

        <View style={styles.journeyCard}>
          <Text style={styles.journeyCardLabel}>TOP PERFORMANCE</Text>
          <Text style={styles.journeyCardValue} numberOfLines={2}>{stats.topMeet}</Text>
        </View>

        <View style={styles.journeyStatsRow}>
          <View style={styles.journeyStat}>
            <Text style={styles.journeyStatNumber}>
{stats.averageTotal.toFixed(0)}
kg
</Text>
            <Text style={styles.journeyStatLabel}>AVG TOTAL</Text>
          </View>
          {improvementText !== null && (
            <View style={styles.journeyStat}>
              <Text
                style={[
                  styles.journeyStatNumber,
                  improved && styles.positiveText,
                ]}
              >
                {improvementText}
              </Text>
              <Text style={styles.journeyStatLabel}>IMPROVEMENT</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  journeyCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    gap: 24,
  },
  journeyHero: {
    alignItems: "center",
    marginBottom: 8,
  },
  journeyHeroNumber: {
    fontSize: 88,
    fontWeight: "900",
    color: Palette.white,
    lineHeight: 92,
  },
  journeyHeroLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: WhiteAlpha[50],
    letterSpacing: 4,
    marginTop: 4,
  },
  journeyCard: {
    backgroundColor: BlackAlpha[25],
    borderRadius: 20,
    padding: 24,
    width: "100%",
    alignItems: "center",
  },
  journeyCardLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: WhiteAlpha[40],
    letterSpacing: 2,
    marginBottom: 8,
  },
  journeyCardValue: {
    fontSize: 20,
    fontWeight: "800",
    color: Palette.white,
    textAlign: "center",
  },
  journeyStatsRow: {
    flexDirection: "row",
    gap: 16,
    width: "100%",
  },
  journeyStat: {
    flex: 1,
    backgroundColor: WhiteAlpha[10],
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
  },
  journeyStatNumber: {
    fontSize: 24,
    fontWeight: "900",
    color: Palette.white,
    marginBottom: 4,
  },
  journeyStatLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: WhiteAlpha[50],
    letterSpacing: 2,
  },
  positiveText: {
    color: WrappedPalette.green,
  },
});
