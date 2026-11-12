import { attemptEstimatorStyles as styles } from "@/components/attempt-estimator/attemptEstimatorStyles";
import { ThemedText } from "@/components/ui/ThemedText";
import type { AppColors } from "@/hooks/useAppColors";
import { noEstimatesCopy, staleEstimatesNote, type EstimatesLoadIssue } from "@/lib/attempt-estimator-copy";
import React from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

export function RefreshingEstimatesRow({ colors }: { colors: AppColors }) {
  return (
    <View
      style={styles.statusRow}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel="Refreshing estimates"
    >
      <ActivityIndicator size="small" color={colors.secondaryText} />
      <ThemedText style={[styles.statusText, { color: colors.secondaryText }]}>
        Refreshing…
      </ThemedText>
    </View>
  );
}

export function StaleEstimatesRow({
  loadIssue,
  colors,
}: {
  loadIssue: Exclude<EstimatesLoadIssue, null>;
  colors: AppColors;
}) {
  return (
    <View style={styles.statusRow} accessible accessibilityLiveRegion="polite">
      <ThemedText style={[styles.statusText, { color: colors.secondaryText }]}>
        {staleEstimatesNote(loadIssue)}
      </ThemedText>
    </View>
  );
}

export function NoEstimatesMessage({
  loadIssue,
  onRetry,
  colors,
}: {
  loadIssue: EstimatesLoadIssue;
  onRetry: () => void;
  colors: AppColors;
}) {
  const copy = noEstimatesCopy(loadIssue);
  return (
    <View style={styles.messageContainer}>
      <ThemedText style={[styles.messageTitle, { color: colors.text }]}>{copy.title}</ThemedText>
      <ThemedText style={[styles.messageText, { color: colors.secondaryText }]}>
        {copy.message}
      </ThemedText>
      <Pressable
        style={({ pressed }) => [
          styles.retryButton,
          { backgroundColor: colors.link },
          pressed && { opacity: 0.8 },
        ]}
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Retry loading estimates"
      >
        <ThemedText style={styles.retryButtonText}>Retry</ThemedText>
      </Pressable>
    </View>
  );
}
