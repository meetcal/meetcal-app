import { athleteResultsStyles as styles } from "@/components/athlete-results/athleteResultsStyles";
import { RateBar } from "@/components/athlete-results/RateBar";
import { ThemedText } from "@/components/ui/ThemedText";
import type { AppColors } from "@/hooks/useAppColors";
import { getRateColor } from "@/lib/athlete-result-display";
import {
  calculateAthleteMakeRates,
  type AttemptRates,
  type AttemptTally,
} from "@/lib/athlete-make-rates";
import type { AthleteMeetResult } from "@/types/athlete-results";
import React, { useMemo } from "react";
import { View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

function AttemptRateRow({
  attemptNumber,
  rates,
  colors,
}: {
  attemptNumber: number;
  rates: AttemptTally;
  colors: AppColors;
}) {
  return (
    <View style={styles.attemptRateRow}>
      <ThemedText style={[styles.attemptRateLabel, { color: colors.secondaryText }]}>
        {attemptNumber}
      </ThemedText>
      <ThemedText
        style={[styles.attemptRateValue, { color: getRateColor(rates.rate, colors) }]}
      >
        {rates.rate.toFixed(1)}%
      </ThemedText>
      <ThemedText style={[styles.attemptRateSubtext, { color: colors.secondaryText }]}>
        {rates.makes}/{rates.total}
      </ThemedText>
    </View>
  );
}

function LiftRateColumn({
  label,
  makeRate,
  attemptRates,
  colors,
}: {
  label: string;
  makeRate: number;
  attemptRates: AttemptRates;
  colors: AppColors;
}) {
  const rateColor = getRateColor(makeRate, colors);
  return (
    <View style={styles.statsColumn}>
      <View style={styles.liftHeader}>
        <ThemedText style={[styles.liftName, { color: colors.secondaryText }]}>
          {label}
        </ThemedText>
        <ThemedText style={[styles.statsValue, { color: rateColor }]}>
          {makeRate.toFixed(1)}%
        </ThemedText>
      </View>
      <View style={styles.rateBarWrap}>
        <RateBar rate={makeRate} color={rateColor} />
      </View>
      <View style={styles.attemptRatesContainer}>
        <AttemptRateRow attemptNumber={1} rates={attemptRates.attempt1} colors={colors} />
        <AttemptRateRow attemptNumber={2} rates={attemptRates.attempt2} colors={colors} />
        <AttemptRateRow attemptNumber={3} rates={attemptRates.attempt3} colors={colors} />
      </View>
    </View>
  );
}

export function AthleteStats({
  results,
  colors,
}: {
  results: AthleteMeetResult[];
  colors: AppColors;
}) {
  const stats = useMemo(() => calculateAthleteMakeRates(results), [results]);

  return (
    <Animated.View
      entering={FadeIn.duration(400)}
      style={[styles.card, { backgroundColor: colors.card, marginTop: 16 }]}
    >
      <View style={[styles.section, { borderBottomColor: colors.border }]}>
        <ThemedText style={styles.meetName}>Success Rates</ThemedText>
      </View>

      <View style={styles.statsGrid}>
        <LiftRateColumn
          label="Snatch"
          makeRate={stats.snatchMakeRate}
          attemptRates={stats.snatchAttemptRates}
          colors={colors}
        />
        <View style={[styles.verticalDivider, { backgroundColor: colors.border }]} />
        <LiftRateColumn
          label="C&J"
          makeRate={stats.cjMakeRate}
          attemptRates={stats.cjAttemptRates}
          colors={colors}
        />
      </View>
    </Animated.View>
  );
}
