import { athleteResultsStyles as styles } from "@/components/athlete-results/athleteResultsStyles";
import { ThemedText } from "@/components/ui/ThemedText";
import type { AppColors } from "@/hooks/useAppColors";
import React from "react";
import { Pressable, View } from "react-native";

export function PartialResultsStatus({
  status,
  canRetry,
  onRetry,
  colors,
}: {
  status: string;
  canRetry: boolean;
  onRetry: () => void;
  colors: AppColors;
}) {
  return (
    <View
      style={styles.statusRow}
      accessible
      accessibilityLiveRegion="polite"
      testID="athlete-results-partial-status"
    >
      <ThemedText style={[styles.statusText, { color: colors.secondaryText }]}>
        {status}
      </ThemedText>
      {canRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry loading the full history"
          hitSlop={8}
          testID="athlete-results-partial-retry"
        >
          <ThemedText style={[styles.statusText, styles.statusRetry, { color: colors.link }]}>
            Retry
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}
