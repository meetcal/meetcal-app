import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { ThemedText } from "@/components/ui/ThemedText";
import { MedalTint, Palette } from "@/constants/Palette";
import type { AppColors } from "@/hooks/useAppColors";
import type { ClubMeetStats } from "@/types/club";

function MedalChip({
  emoji,
  count,
  label,
  tint,
  countColor,
  labelColor,
}: {
  emoji: string;
  count: number;
  label: string;
  tint: string;
  countColor: string;
  labelColor: string;
}) {
  return (
    <View style={[styles.medalChip, { backgroundColor: tint }]}>
      <Text style={styles.medalChipEmoji}>{emoji}</Text>
      <ThemedText style={[styles.medalChipCount, { color: countColor }]}>
        {count}
      </ThemedText>
      <ThemedText style={[styles.medalChipLabel, { color: labelColor }]}>
        {label}
      </ThemedText>
    </View>
  );
}

export function ClubRecapHero({
  club,
  meet,
  stats,
  colors,
}: {
  club: string | undefined;
  meet: string | undefined;
  stats: ClubMeetStats;
  colors: AppColors;
}) {
  const totalMedals = stats.goldMedals + stats.silverMedals + stats.bronzeMedals;

  return (
    <View style={[styles.heroBanner, { backgroundColor: colors.card }]}>
      <View style={styles.heroAccentBar} />

      <ThemedText style={[styles.heroClubName, { color: colors.text }]}>
        {club}
      </ThemedText>
      <ThemedText style={[styles.heroMeetName, { color: colors.secondaryText }]}>
        {meet}
      </ThemedText>

      {totalMedals > 0 && (
        <View style={styles.medalChipsRow}>
          {stats.goldMedals > 0 && (
            <MedalChip
              emoji="🥇"
              count={stats.goldMedals}
              label="Gold"
              tint={MedalTint.gold}
              countColor={colors.goldText}
              labelColor={colors.secondaryText}
            />
          )}
          {stats.silverMedals > 0 && (
            <MedalChip
              emoji="🥈"
              count={stats.silverMedals}
              label="Silver"
              tint={MedalTint.silver}
              countColor={colors.silverText}
              labelColor={colors.secondaryText}
            />
          )}
          {stats.bronzeMedals > 0 && (
            <MedalChip
              emoji="🥉"
              count={stats.bronzeMedals}
              label="Bronze"
              tint={MedalTint.bronze}
              countColor={colors.bronzeText}
              labelColor={colors.secondaryText}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  heroBanner: {
    margin: 16,
    marginBottom: 8,
    padding: 24,
    borderRadius: 20,
    overflow: "hidden",
  },
  heroAccentBar: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: Palette.gold,
    borderTopLeftRadius: 20,
    borderBottomLeftRadius: 20,
  },
  heroClubName: {
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.5,
    lineHeight: 34,
  },
  heroMeetName: {
    fontSize: 15,
    fontWeight: "500",
    marginTop: 6,
  },
  medalChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 18,
  },
  medalChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  medalChipEmoji: {
    fontSize: 16,
  },
  medalChipCount: {
    fontSize: 15,
    fontWeight: "700",
  },
  medalChipLabel: {
    fontSize: 13,
    fontWeight: "500",
  },
});
