import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { Palette, RecapCardPalette, WhiteAlpha } from "@/constants/Palette";
import { formatMakeRate } from "@/lib/club-recap";
import type { ClubMeetStats } from "@/types/club";

export const RECAP_IMAGE_WIDTH = 800;
export const RECAP_IMAGE_HEIGHT = 1000;

function ShareableMedalBlock({
  count,
  label,
  emoji,
  borderColor,
  countColor,
}: {
  count: number;
  label: string;
  emoji: string;
  borderColor: string;
  countColor: string;
}) {
  return (
    <View style={[styles.medalBlock, { borderColor }]}>
      <Text style={styles.medalBlockEmoji}>{emoji}</Text>
      <Text style={[styles.medalBlockCount, { color: countColor }]}>
        {count}
      </Text>
      <Text style={styles.medalBlockLabel}>{label}</Text>
    </View>
  );
}

function ShareableStatCard({
  emoji,
  value,
  label,
  accentColor,
}: {
  emoji: string;
  value: string;
  label: string;
  accentColor: string;
}) {
  return (
    <View style={[styles.statCard, { borderTopColor: accentColor }]}>
      <Text style={styles.statEmoji}>{emoji}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ShareableMakeRateCard({
  value,
  label,
  accentColor,
}: {
  value: string;
  label: string;
  accentColor: string;
}) {
  return (
    <View style={[styles.makeRateCard, { borderTopColor: accentColor }]}>
      <Text style={styles.makeRateValue}>{value}</Text>
      <Text style={styles.makeRateLabel}>{label}</Text>
    </View>
  );
}

export const ShareableRecapView = React.forwardRef<
  React.ComponentRef<typeof View>,
  { club: string; meet: string; stats: ClubMeetStats }
>(({ club, meet, stats }, ref) => {
  return (
    <View ref={ref} style={styles.container}>

      <View style={styles.brandingRow}>
        <Image
          source={require("@/assets/images/MeetCal-no-bg.png")}
          style={styles.brandLogo}
          resizeMode="contain"
        />
        <Text style={styles.brandName}>MeetCal</Text>
        <View style={styles.brandDot} />
        <Text style={styles.brandTag}>MEET RECAP</Text>
      </View>

      <View style={styles.goldSeparator} />

      <Text style={styles.clubName} numberOfLines={2}>
        {club}
      </Text>
      <Text style={styles.meetName}>{meet}</Text>

      <View style={styles.medalRow}>
        <ShareableMedalBlock
          count={stats.goldMedals}
          label="GOLD"
          emoji="🥇"
          borderColor={RecapCardPalette.goldMedalBorder}
          countColor={Palette.gold}
        />
        <ShareableMedalBlock
          count={stats.silverMedals}
          label="SILVER"
          emoji="🥈"
          borderColor={RecapCardPalette.silverMedalBorder}
          countColor={Palette.silver}
        />
        <ShareableMedalBlock
          count={stats.bronzeMedals}
          label="BRONZE"
          emoji="🥉"
          borderColor={RecapCardPalette.bronzeMedalBorder}
          countColor={Palette.bronze}
        />
      </View>

      <View style={styles.statsGrid}>
        <ShareableStatCard
          emoji="👥"
          value={stats.totalAthletes.toString()}
          label="ATHLETES"
          accentColor={Palette.systemBlue}
        />
        <ShareableStatCard
          emoji="⚖️"
          value={`${Math.round(stats.totalWeightLifted)} kg`}
          label="TOTAL WEIGHT"
          accentColor={Palette.systemPurple}
        />
        <ShareableStatCard
          emoji="⭐"
          value={stats.totalPRs.toString()}
          label="COMP PRs"
          accentColor={Palette.systemOrange}
        />
        <ShareableStatCard
          emoji="✅"
          value={stats.perfect6for6.toString()}
          label="PERFECT 6/6"
          accentColor={Palette.systemGreen}
        />
      </View>

      <View style={styles.makeRateRow}>
        <ShareableMakeRateCard
          value={formatMakeRate(stats.snatchMakeRate)}
          label="SNATCH MAKE"
          accentColor={Palette.systemPinkDark}
        />
        <ShareableMakeRateCard
          value={formatMakeRate(stats.cjMakeRate)}
          label="C&J MAKE"
          accentColor={Palette.systemGreenDark}
        />
        <ShareableMakeRateCard
          value={formatMakeRate(stats.combinedMakeRate)}
          label="OVERALL MAKE"
          accentColor={Palette.systemYellowDark}
        />
      </View>

    </View>
  );
});

ShareableRecapView.displayName = "ShareableRecapView";

const styles = StyleSheet.create({
  container: {
    width: RECAP_IMAGE_WIDTH,
    height: RECAP_IMAGE_HEIGHT,
    backgroundColor: RecapCardPalette.background,
    padding: 50,
    overflow: "hidden",
  },
  brandingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
  },
  brandLogo: {
    width: 22,
    height: 22,
  },
  brandName: {
    fontSize: 18,
    fontWeight: "700",
    color: Palette.white,
    letterSpacing: 0.3,
  },
  brandDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Palette.gold,
  },
  brandTag: {
    fontSize: 11,
    fontWeight: "700",
    color: Palette.systemGray,
    letterSpacing: 2,
  },
  goldSeparator: {
    height: 2,
    backgroundColor: Palette.gold,
    opacity: 0.6,
    borderRadius: 1,
    marginBottom: 24,
  },
  clubName: {
    fontSize: 52,
    fontWeight: "800",
    color: Palette.white,
    letterSpacing: -1.5,
    lineHeight: 58,
    marginBottom: 8,
  },
  meetName: {
    fontSize: 20,
    fontWeight: "500",
    color: Palette.systemGray,
    letterSpacing: 0.2,
    marginBottom: 24,
  },
  medalRow: {
    flexDirection: "row",
    gap: 14,
    marginBottom: 24,
  },
  medalBlock: {
    flex: 1,
    backgroundColor: WhiteAlpha[5],
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 12,
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
  },
  medalBlockEmoji: {
    fontSize: 36,
    lineHeight: 40,
  },
  medalBlockCount: {
    fontSize: 48,
    fontWeight: "900",
    lineHeight: 52,
    includeFontPadding: false,
    letterSpacing: -1,
  },
  medalBlockLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: Palette.systemGray,
    letterSpacing: 1.5,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 14,
    marginBottom: 24,
  },
  statCard: {
    width: "49%",
    backgroundColor: WhiteAlpha[6],
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 20,
    borderTopWidth: 3,
    gap: 8,
  },
  statEmoji: {
    fontSize: 30,
    lineHeight: 34,
  },
  statValue: {
    fontSize: 40,
    fontWeight: "900",
    color: Palette.white,
    letterSpacing: -1,
    lineHeight: 44,
    includeFontPadding: false,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: Palette.systemGray,
    letterSpacing: 1.2,
  },
  makeRateRow: {
    flexDirection: "row",
    gap: 12,
  },
  makeRateCard: {
    flex: 1,
    backgroundColor: WhiteAlpha[6],
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 14,
    alignItems: "center",
    borderTopWidth: 3,
    gap: 8,
  },
  makeRateValue: {
    fontSize: 38,
    fontWeight: "900",
    color: Palette.white,
    lineHeight: 42,
    includeFontPadding: false,
  },
  makeRateLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: Palette.systemGray,
    letterSpacing: 1,
  },
});
