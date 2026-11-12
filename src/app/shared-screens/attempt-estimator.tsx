import { attemptEstimatorStyles as styles } from "@/components/attempt-estimator/attemptEstimatorStyles";
import { EstimateCard } from "@/components/attempt-estimator/EstimateCard";
import { EstimateSkeletonCard } from "@/components/attempt-estimator/EstimateSkeletonCard";
import {
  NoEstimatesMessage,
  RefreshingEstimatesRow,
  StaleEstimatesRow,
} from "@/components/attempt-estimator/EstimatesStatus";
import { SubscriptionGate } from "@/components/ui/SubscriptionGate";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { useAppColors } from "@/hooks/useAppColors";
import { useAttemptEstimates } from "@/hooks/useAttemptEstimates";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";
import { sortEstimatesByAttemptsOut } from "@/lib/attempt-estimator";
import { stackHeaderOptions } from "@/lib/stack-header-options";
import { Stack, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { ScrollView, View } from "react-native";

const SKELETON_CARD_KEYS = [1, 2, 3, 4, 5, 6];

export default function AttemptEstimatorScreen() {
  return (
    <SubscriptionGate feature="attempt-estimator">
      <AttemptEstimatorContent />
    </SubscriptionGate>
  );
}

function useExpandedAthletes() {
  const [expandedAthletes, setExpandedAthletes] = useState<Set<string>>(new Set());
  const toggleAthlete = (athleteId: string) => {
    const newExpanded = new Set(expandedAthletes);
    if (newExpanded.has(athleteId)) {
      newExpanded.delete(athleteId);
    } else {
      newExpanded.add(athleteId);
    }
    setExpandedAthletes(newExpanded);
  };
  return { expandedAthletes, toggleAthlete };
}

function AttemptEstimatorContent() {
  const screenInsets = useScreenHorizontalInsets();
  const colors = useAppColors();
  const params = useLocalSearchParams<{
    sessionNumber: string;
    platform: string;
    meet: string;
  }>();

  const sessionNumber = params.sessionNumber ? parseInt(params.sessionNumber) : NaN;
  const hasValidParams = !isNaN(sessionNumber) && !!params.platform && !!params.meet;

  const { estimates, loading, refreshing, loadIssue, reload } = useAttemptEstimates({
    meet: params.meet,
    sessionNumber,
    platform: params.platform,
    hasValidParams,
  });
  const { expandedAthletes, toggleAthlete } = useExpandedAthletes();

  const sortedEstimates = sortEstimatesByAttemptsOut(estimates);
  const containerStyle = [styles.container, { backgroundColor: colors.background }, screenInsets];

  if (!hasValidParams) {
    return (
      <ThemedView style={containerStyle}>
        <Stack.Screen
          options={{
            ...stackHeaderOptions(colors),
            headerTitle: "Attempt Estimator",
            headerTransparent: true,
            headerLargeTitle: false,
          }}
        />
        <View style={styles.emptyContainer}>
          <ThemedText style={{ fontSize: 15, color: colors.secondaryText }}>
            Missing session information.
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  const header = (
    <Stack.Screen
      options={{
        ...stackHeaderOptions(colors),
        headerTitle: "Attempt Estimator",
      }}
    />
  );

  if (loading) {
    return (
      <ThemedView style={containerStyle}>
        {header}
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {SKELETON_CARD_KEYS.map((i) => (
            <EstimateSkeletonCard key={i} colors={colors} />
          ))}
        </ScrollView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={containerStyle}>
      {header}

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {refreshing && <RefreshingEstimatesRow colors={colors} />}
        {!refreshing && loadIssue && sortedEstimates.length > 0 && (
          <StaleEstimatesRow loadIssue={loadIssue} colors={colors} />
        )}
        <View
          style={[
            styles.disclaimerCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <ThemedText style={[styles.disclaimerText, { color: colors.secondaryText }]}>
            This data is based on historical meet results and may be inaccurate
            if the session includes athletes at their first meet. Always refer
            to the board for the final count.
          </ThemedText>
        </View>

        {sortedEstimates.length === 0 && (
          <NoEstimatesMessage
            loadIssue={loadIssue}
            onRetry={() => {
              void reload();
            }}
            colors={colors}
          />
        )}

        {sortedEstimates.map((estimate) => (
          <EstimateCard
            key={estimate.id}
            estimate={estimate}
            expanded={expandedAthletes.has(estimate.id)}
            onToggle={toggleAthlete}
            colors={colors}
          />
        ))}
      </ScrollView>
    </ThemedView>
  );
}
