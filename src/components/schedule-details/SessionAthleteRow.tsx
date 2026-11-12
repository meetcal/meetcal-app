import { sessionAthletesStyles as styles } from "@/components/schedule-details/sessionAthletesStyles";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import type { AthleteBests } from "@/data/types/athletes";
import type { AppColors } from "@/hooks/useAppColors";
import type { SessionAthlete } from "@/types/schedule-details";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

function BestStat({
  label,
  value,
  colors,
}: {
  label: string;
  value: number | null | undefined;
  colors: AppColors;
}) {
  return (
    <View style={styles.statItem}>
      <ThemedText style={[styles.statLabel, { color: colors.secondaryText }]}>
        {label}
      </ThemedText>
      <ThemedText style={styles.statValue}>
        {value == null ? "—" : `${value}kg`}
      </ThemedText>
    </View>
  );
}

function LockedBests({ onPress, colors }: { onPress: () => void; colors: AppColors }) {
  const labelStyle = [styles.statLabel, styles.premiumStatLabel, { color: colors.secondaryText }];
  return (
    <Pressable
      style={({ pressed }) => [styles.premiumStatsContainer, pressed && { opacity: 0.8 }]}
      onPress={onPress}
    >
      <View style={styles.premiumLabelsRow}>
        <ThemedText style={labelStyle}>Best Sn</ThemedText>
        <ThemedText style={labelStyle}>Best CJ</ThemedText>
        <ThemedText style={labelStyle}>Best Total</ThemedText>
      </View>
      <View style={styles.premiumUnlockBadge}>
        <IconSymbol name="lock" size={11} color="#FFFFFF" />
        <ThemedText style={styles.premiumUnlockText}>Unlock with Premium</ThemedText>
        <IconSymbol name="chevron.right" size={11} color="#FFFFFF" />
      </View>
    </Pressable>
  );
}

export function SessionAthleteRow({
  athlete,
  bests,
  isSubscribed,
  isLast,
  colors,
  onUnlockBests,
  onSeeAllResults,
}: {
  athlete: SessionAthlete;
  bests: AthleteBests | undefined;
  isSubscribed: boolean;
  isLast: boolean;
  colors: AppColors;
  onUnlockBests: () => void;
  onSeeAllResults: (athleteName: string) => void;
}) {
  return (
    <View
      style={[
        styles.athleteSection,
        !isLast && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <View style={styles.athleteHeader}>
        <ThemedText style={styles.athleteName}>{athlete.name}</ThemedText>
      </View>
      <ThemedText style={[styles.athleteDetail, { color: colors.secondaryText }]}>
        Age:{" "}{athlete.age}{" "}| Weight Class:{" "}{athlete.weightClass}
      </ThemedText>
      <ThemedText style={[styles.athleteDetail, { color: colors.secondaryText }]}>
        {athlete.club}
      </ThemedText>

      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <ThemedText style={[styles.statLabel, { color: colors.secondaryText }]}>
            Entry Total
          </ThemedText>
          <ThemedText style={styles.statValue}>{athlete.entryTotal}kg</ThemedText>
        </View>
        {isSubscribed ? (
          <>
            <BestStat label="Best Sn" value={bests?.snatch_best} colors={colors} />
            <BestStat label="Best CJ" value={bests?.cj_best} colors={colors} />
            <BestStat label="Best Total" value={bests?.total} colors={colors} />
          </>
        ) : (
          <LockedBests onPress={onUnlockBests} colors={colors} />
        )}
      </View>

      {isSubscribed ? (
        <Pressable
          style={({ pressed }) => [styles.meetResultsButton, pressed && { opacity: 0.8 }]}
          onPress={() => onSeeAllResults(athlete.name)}
        >
          <ThemedText style={styles.meetResultsText}>See All Meet Results</ThemedText>
          <IconSymbol name="chevron.right" size={13} color={colors.link} />
        </Pressable>
      ) : null}
    </View>
  );
}
