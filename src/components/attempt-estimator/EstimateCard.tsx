import { attemptEstimatorStyles as styles } from "@/components/attempt-estimator/attemptEstimatorStyles";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import type { AppColors } from "@/hooks/useAppColors";
import {
  formatAttemptsOut,
  generateAthleteNotes,
  type AthleteAttemptEstimate,
} from "@/lib/attempt-estimator";
import React from "react";
import { Pressable, View } from "react-native";

function AttemptsOutLine({
  lift,
  attemptsOut,
  colors,
}: {
  lift: string;
  attemptsOut: number | null;
  colors: AppColors;
}) {
  return (
    <ThemedText style={[styles.detailText, { color: colors.secondaryText }]}>
      {attemptsOut !== null
        ? `${lift}: ${formatAttemptsOut(attemptsOut)}`
        : `${lift}: No data available`}
    </ThemedText>
  );
}

function EstimatedAttemptsRow({
  lift,
  estimates,
  colors,
}: {
  lift: string;
  estimates: number[];
  colors: AppColors;
}) {
  const cellStyle = [styles.tableCellText, { color: colors.secondaryText }];
  return (
    <View style={styles.tableRow}>
      <ThemedText style={[styles.tableHeader, styles.tableCell]}>{lift}</ThemedText>
      <ThemedText style={cellStyle}>{estimates[0] ?? "—"}</ThemedText>
      <ThemedText style={cellStyle}>{estimates.length > 1 ? estimates[1] : "—"}</ThemedText>
      <ThemedText style={cellStyle}>{estimates.length > 2 ? estimates[2] : "—"}</ThemedText>
    </View>
  );
}

function hasOpener(estimates: number[]): boolean {
  return estimates.length > 0 && estimates[0] > 0;
}

function EstimatedAttemptsTable({
  estimate,
  colors,
}: {
  estimate: AthleteAttemptEstimate;
  colors: AppColors;
}) {
  const tableDivider = (
    <View style={[styles.tableDivider, { backgroundColor: colors.border }]} />
  );
  return (
    <View style={styles.table}>
      <View style={styles.tableRow}>
        <ThemedText style={[styles.tableHeader, styles.tableCell]}></ThemedText>
        <ThemedText style={[styles.tableHeader, styles.tableCell]}>1</ThemedText>
        <ThemedText style={[styles.tableHeader, styles.tableCell]}>2</ThemedText>
        <ThemedText style={[styles.tableHeader, styles.tableCell]}>3</ThemedText>
      </View>
      {tableDivider}
      {hasOpener(estimate.snatchEstimates) && (
        <>
          <EstimatedAttemptsRow
            lift="Snatch"
            estimates={estimate.snatchEstimates}
            colors={colors}
          />
          {tableDivider}
        </>
      )}
      {hasOpener(estimate.cjEstimates) && (
        <EstimatedAttemptsRow lift="CJ" estimates={estimate.cjEstimates} colors={colors} />
      )}
    </View>
  );
}

function EstimateDetails({
  estimate,
  colors,
}: {
  estimate: AthleteAttemptEstimate;
  colors: AppColors;
}) {
  const divider = <View style={[styles.divider, { backgroundColor: colors.border }]} />;
  return (
    <View style={[styles.athleteDetails, { borderTopColor: colors.border }]}>
      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle}>Estimated Count</ThemedText>
        <AttemptsOutLine lift="Snatch" attemptsOut={estimate.snatchAttemptsOut} colors={colors} />
        <AttemptsOutLine lift="CJ" attemptsOut={estimate.cjAttemptsOut} colors={colors} />
      </View>
      {divider}
      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle}>Estimated Attempts</ThemedText>
        <EstimatedAttemptsTable estimate={estimate} colors={colors} />
      </View>
      {divider}
      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle}>Athlete Notes</ThemedText>
        <ThemedText style={[styles.detailText, { color: colors.secondaryText }]}>
          {generateAthleteNotes(estimate)}
        </ThemedText>
      </View>
    </View>
  );
}

export function EstimateCard({
  estimate,
  expanded,
  onToggle,
  colors,
}: {
  estimate: AthleteAttemptEstimate;
  expanded: boolean;
  onToggle: (athleteId: string) => void;
  colors: AppColors;
}) {
  return (
    <View style={[styles.athleteCard, { backgroundColor: colors.card }]}>
      <Pressable
        style={styles.athleteHeader}
        onPress={() => onToggle(estimate.id)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityHint="Shows the estimated attempts and notes"
      >
        <View style={styles.athleteHeaderText}>
          <ThemedText style={styles.athleteName}>{estimate.athleteName}</ThemedText>
          <ThemedText style={[styles.athleteSubtitle, { color: colors.secondaryText }]}>
            {`Snatch: ${formatAttemptsOut(estimate.snatchAttemptsOut)}`}
          </ThemedText>
        </View>
        <IconSymbol
          name={expanded ? "chevron.down" : "chevron.right"}
          size={16}
          color={colors.secondaryText}
        />
      </Pressable>

      {expanded && <EstimateDetails estimate={estimate} colors={colors} />}
    </View>
  );
}
