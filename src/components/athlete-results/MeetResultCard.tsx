import { athleteResultsStyles as styles } from "@/components/athlete-results/athleteResultsStyles";
import { ThemedText } from "@/components/ui/ThemedText";
import type { AppColors } from "@/hooks/useAppColors";
import { formatResultDate } from "@/lib/athlete-result-display";
import type { AthleteMeetResult } from "@/types/athlete-results";
import React from "react";
import { View } from "react-native";

function AttemptDisplay({
  attempt,
  colors,
}: {
  attempt: number | null;
  colors: AppColors;
}) {
  if (attempt === null || attempt === 0) {
    return (
      <ThemedText style={[styles.attempt, { color: colors.secondaryText }]}>
        —
      </ThemedText>
    );
  }

  const isSuccess = attempt > 0;
  return (
    <ThemedText
      style={[styles.attempt, { color: isSuccess ? colors.success : colors.fail }]}
    >
      {Math.abs(attempt)}
    </ThemedText>
  );
}

function LiftAttemptsSection({
  label,
  attempts,
  colors,
}: {
  label: string;
  attempts: readonly [number | null, number | null, number | null];
  colors: AppColors;
}) {
  return (
    <View style={[styles.section, { borderBottomColor: colors.border }]}>
      <View style={styles.liftRow}>
        <ThemedText style={[styles.liftName, { color: colors.secondaryText }]}>
          {label}
        </ThemedText>
        <View style={styles.attempts}>
          <AttemptDisplay attempt={attempts[0]} colors={colors} />
          <AttemptDisplay attempt={attempts[1]} colors={colors} />
          <AttemptDisplay attempt={attempts[2]} colors={colors} />
        </View>
      </View>
    </View>
  );
}

export const MeetResultCard = React.memo(function MeetResultCard({
  result,
  colors,
  isSnatchPR,
  isCJPR,
  isTotalPR,
  isFirst,
}: {
  result: AthleteMeetResult;
  colors: AppColors;
  isSnatchPR: boolean;
  isCJPR: boolean;
  isTotalPR: boolean;
  isFirst: boolean;
}) {
  return (
    <View
      style={[styles.card, { backgroundColor: colors.card }, isFirst && { marginTop: 16 }]}
    >
      <View style={[styles.section, { borderBottomColor: colors.border }]}>
        <View style={styles.meetNameRow}>
          <ThemedText style={styles.meetName}>{result.meet}</ThemedText>
          {isSnatchPR || isCJPR || isTotalPR ? (
            <View style={[styles.prBadge, { backgroundColor: colors.prBadge }]}>
              <ThemedText style={styles.prBadgeText}>PR</ThemedText>
            </View>
          ) : null}
        </View>
        <ThemedText style={[styles.meetDate, { color: colors.secondaryText }]}>
          Date: {formatResultDate(result.date)}
        </ThemedText>
        <ThemedText style={[styles.weightClass, { color: colors.secondaryText }]}>
          {result.age}
        </ThemedText>
      </View>

      <LiftAttemptsSection
        label="Snatch"
        attempts={[result.snatch1, result.snatch2, result.snatch3]}
        colors={colors}
      />
      <LiftAttemptsSection
        label="Clean & Jerk"
        attempts={[result.cj1, result.cj2, result.cj3]}
        colors={colors}
      />

      <View style={styles.section}>
        <ThemedText style={styles.total}>
          <ThemedText style={[styles.total, isSnatchPR && { color: colors.prText }]}>
            {result.snatch_best ?? "—"}
          </ThemedText>
          /
          <ThemedText style={[styles.total, isCJPR && { color: colors.prText }]}>
            {result.cj_best ?? "—"}
          </ThemedText>
          /
          <ThemedText style={[styles.total, isTotalPR && { color: colors.prText }]}>
            {result.total ?? "—"}
          </ThemedText>
        </ThemedText>
      </View>
    </View>
  );
});
