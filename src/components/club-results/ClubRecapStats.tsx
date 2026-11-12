import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import type { AppColors } from "@/hooks/useAppColors";
import { formatMakeRate } from "@/lib/club-recap";
import type { ClubMeetStats } from "@/types/club";

function PremiumStatCard({
  title,
  value,
  icon,
  accentColor,
  colors,
}: {
  title: string;
  value: string;
  icon: string;
  accentColor: string;
  colors: AppColors;
}) {
  return (
    <View
      style={[
        styles.statCard,
        {
          backgroundColor: colors.card,
          borderTopColor: accentColor,
        },
      ]}
    >
      <IconSymbol name={icon} size={26} color={accentColor} />
      <ThemedText style={[styles.statValue, { color: colors.text }]}>{value}</ThemedText>
      <ThemedText style={[styles.statTitle, { color: colors.secondaryText }]}>{title}</ThemedText>
    </View>
  );
}

function MakeRateCard({
  title,
  value,
  accentColor,
  colors,
}: {
  title: string;
  value: string;
  accentColor: string;
  colors: AppColors;
}) {
  return (
    <View
      style={[
        styles.makeRateCard,
        {
          backgroundColor: colors.card,
          borderTopColor: accentColor,
        },
      ]}
    >
      <IconSymbol name="chart.bar.fill" size={20} color={accentColor} />
      <ThemedText style={[styles.makeRateValue, { color: colors.text }]}>
        {value}
      </ThemedText>
      <ThemedText style={[styles.makeRateTitle, { color: colors.secondaryText }]}>
        {title}
      </ThemedText>
    </View>
  );
}

export function ClubRecapStats({ stats, colors }: { stats: ClubMeetStats; colors: AppColors }) {
  return (
    <>
      <View style={styles.statsGrid}>
        <PremiumStatCard
          title="Athletes"
          value={stats.totalAthletes.toString()}
          icon={Platform.OS === "ios" ? "person.3.fill" : "people"}
          accentColor={colors.link}
          colors={colors}
        />
        <PremiumStatCard
          title="Total Weight"
          value={`${Math.round(stats.totalWeightLifted)} kg`}
          icon={Platform.OS === "ios" ? "scalemass.fill" : "barbell"}
          accentColor={colors.totalColor}
          colors={colors}
        />
        <PremiumStatCard
          title="Comp PRs"
          value={stats.totalPRs.toString()}
          icon={Platform.OS === "ios" ? "star.fill" : "star"}
          accentColor={colors.prColor}
          colors={colors}
        />
        <PremiumStatCard
          title="Perfect 6/6"
          value={stats.perfect6for6.toString()}
          icon={Platform.OS === "ios" ? "checkmark.circle.fill" : "checkmark-circle"}
          accentColor={colors.success}
          colors={colors}
        />
      </View>
      <View style={styles.makeRateRow}>
        <MakeRateCard
          title="Snatch"
          value={formatMakeRate(stats.snatchMakeRate)}
          accentColor={colors.fail}
          colors={colors}
        />
        <MakeRateCard
          title="C&J"
          value={formatMakeRate(stats.cjMakeRate)}
          accentColor={colors.success}
          colors={colors}
        />
        <MakeRateCard
          title="Overall"
          value={formatMakeRate(stats.combinedMakeRate)}
          accentColor={colors.link}
          colors={colors}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: 16,
    paddingTop: 8,
    gap: 12,
  },
  statCard: {
    flex: 1,
    minWidth: "45%",
    padding: 18,
    borderRadius: 16,
    alignItems: "flex-start",
    gap: 6,
    borderTopWidth: 3,
  },
  statValue: {
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: -1,
    lineHeight: 36,
    includeFontPadding: false,
    marginTop: 6,
  },
  statTitle: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  makeRateRow: {
    flexDirection: "row",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
  },
  makeRateCard: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    alignItems: "flex-start",
    gap: 5,
    borderTopWidth: 3,
  },
  makeRateValue: {
    fontSize: 24,
    fontWeight: "800",
    lineHeight: 28,
    includeFontPadding: false,
  },
  makeRateTitle: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
});
