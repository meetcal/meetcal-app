import { athleteResultsStyles as styles } from "@/components/athlete-results/athleteResultsStyles";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import type { AppColors } from "@/hooks/useAppColors";
import { formatResultDate } from "@/lib/athlete-result-display";
import type { AthleteChoice } from "@/lib/athlete-results-load";
import { getChevronIcon } from "@/lib/start-list-utils";
import type { LifterChoice } from "@/data/types/athletes";
import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

export function resultsCount(count: number): string {
  return `${count} ${count === 1 ? "Result" : "Results"}`;
}

export function lifterChoiceDetail(lifter: LifterChoice): string {
  const latest = formatResultDate(lifter.latestDate);
  return latest ? `${resultsCount(lifter.results)} · Latest ${latest}` : resultsCount(lifter.results);
}

function ChoiceRow({
  title,
  label,
  detail,
  colors,
  isLast,
  onPress,
}: {
  title: string;
  label: string;
  detail: string;
  colors: AppColors;
  isLast: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.section,
        choiceStyles.row,
        { borderBottomColor: colors.border, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth },
        pressed && { backgroundColor: colors.pressed },
      ]}
    >
      <View style={choiceStyles.text}>
        <ThemedText style={choiceStyles.title}>{title}</ThemedText>
        {label ? <ThemedText style={[choiceStyles.line, { color: colors.secondaryText }]}>{label}</ThemedText> : null}
        <ThemedText style={[choiceStyles.line, { color: colors.secondaryText }]}>{detail}</ThemedText>
      </View>
      <IconSymbol name={getChevronIcon("right")} size={20} color={colors.secondaryText} />
    </Pressable>
  );
}

export function LifterChoiceList({
  choice,
  colors,
  bottomInset,
  onChooseLifter,
  onChooseOther,
}: {
  choice: AthleteChoice;
  colors: AppColors;
  bottomInset: number;
  onChooseLifter: (lifter: LifterChoice) => void;
  onChooseOther: () => void;
}) {
  const hasOther = choice.otherResults > 0;
  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset + 20 }]}
    >
      <View style={[styles.card, { backgroundColor: colors.card, marginTop: 16 }]}>
        {choice.lifters.map((lifter, index) => (
          <ChoiceRow
            key={lifter.id}
            title={lifter.name}
            label={lifter.label}
            detail={lifterChoiceDetail(lifter)}
            colors={colors}
            isLast={!hasOther && index === choice.lifters.length - 1}
            onPress={() => onChooseLifter(lifter)}
          />
        ))}
        {hasOther ? (
          <ChoiceRow
            title="Other Results For This Name"
            label=""
            detail={resultsCount(choice.otherResults)}
            colors={colors}
            isLast
            onPress={onChooseOther}
          />
        ) : null}
      </View>
    </ScrollView>
  );
}

const choiceStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
  },
  line: {
    fontSize: 15,
  },
});
