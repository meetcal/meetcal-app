import { athleteResultsStyles as styles } from "@/components/athlete-results/athleteResultsStyles";
import { AthleteStats } from "@/components/athlete-results/AthleteStats";
import { MeetResultCard } from "@/components/athlete-results/MeetResultCard";
import { PartialResultsStatus } from "@/components/athlete-results/PartialResultsStatus";
import { EmptyState } from "@/components/ui/EmptyState";
import { SubscriptionGate } from "@/components/ui/SubscriptionGate";
import { LoadingLabel } from "@/components/ui/LoadingLabel";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { useAppColors } from "@/hooks/useAppColors";
import { useAthleteResults } from "@/hooks/useAthleteResults";
import { useIsOffline } from "@/hooks/useIsOffline";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";
import { findPRIndexes, type PRIndexes } from "@/lib/athlete-prs";
import { meetResultKey } from "@/lib/athlete-result-display";
import { partialResultsStatus, showsCareerStats } from "@/lib/athlete-results-load";
import { loadFailureCopy } from "@/lib/load-failure";
import { SLIDE_IN_FROM_RIGHT, stackHeaderOptions } from "@/lib/stack-header-options";
import type { AthleteMeetResult } from "@/types/athlete-results";
import { FlashList } from "@shopify/flash-list";
import { Stack, useLocalSearchParams } from "expo-router";
import React, { useCallback, useMemo } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const NO_PR_INDEXES: PRIndexes = { snatch: -1, cj: -1, total: -1 };

export default function AthleteResultsScreen() {
  return (
    <SubscriptionGate feature="athlete-results">
      <AthleteResultsContent />
    </SubscriptionGate>
  );
}

function AthleteResultsContent() {
  const screenInsets = useScreenHorizontalInsets();
  const colors = useAppColors();
  const { name } = useLocalSearchParams<{ name?: string }>();
  const insets = useSafeAreaInsets();
  const [isOffline] = useIsOffline();
  const { loading, athleteResults, loadFailed, rowsSource, loadOutcome, retryLoad } =
    useAthleteResults(name);

  const careerStats = showsCareerStats(rowsSource);
  const prIndexes = useMemo(
    () => (careerStats ? findPRIndexes(athleteResults) : NO_PR_INDEXES),
    [athleteResults, careerStats],
  );
  const partialStatus = partialResultsStatus({
    source: rowsSource,
    outcome: loadOutcome,
    isOffline,
  });

  const cardExtraData = useMemo(() => ({ prIndexes, colors }), [prIndexes, colors]);
  const renderResultCard = useCallback(
    ({ item, index }: { item: AthleteMeetResult; index: number }) => (
      <MeetResultCard
        result={item}
        colors={colors}
        isSnatchPR={index === prIndexes.snatch}
        isCJPR={index === prIndexes.cj}
        isTotalPR={index === prIndexes.total}
        isFirst={index === 0}
      />
    ),
    [colors, prIndexes],
  );

  if (!name) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText>No athlete selected</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }, screenInsets]}
    >
      <Stack.Screen
        options={{
          ...stackHeaderOptions(colors),
          ...SLIDE_IN_FROM_RIGHT,
          headerTitle: name?.toString() || "Meet Results",
        }}
      />

      {loading || athleteResults.length === 0 ? (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 20 }]}
        >
          <View style={[styles.card, { backgroundColor: colors.card, marginTop: 16 }]}>
            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.secondaryText} />
                <LoadingLabel label="" style={[styles.loadingLabel, { color: colors.secondaryText }]} />
              </View>
            ) : loadFailed ? (
              <EmptyState
                title={loadFailureCopy("results", isOffline).title}
                message={loadFailureCopy("results", isOffline).message}
                actionLabel="Retry"
                onActionPress={retryLoad}
              />
            ) : (
              <View style={styles.emptyStateContainer}>
                <ThemedText style={[styles.emptyStateText, { color: colors.secondaryText }]}>
                  No meet results found for{" "}
                  {name}
                </ThemedText>
              </View>
            )}
          </View>
        </ScrollView>
      ) : (
        <FlashList
          data={athleteResults}
          extraData={cardExtraData}
          keyExtractor={meetResultKey}
          renderItem={renderResultCard}
          ListHeaderComponent={
            <>
              {partialStatus ? (
                <PartialResultsStatus
                  status={partialStatus}
                  canRetry={loadOutcome === "offline-partial"}
                  onRetry={retryLoad}
                  colors={colors}
                />
              ) : null}
              {careerStats ? <AthleteStats results={athleteResults} colors={colors} /> : null}
            </>
          }
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: insets.bottom + 20,
          }}
        />
      )}
    </ThemedView>
  );
}
