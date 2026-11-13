import type { AthleteRequest } from "@/lib/api/results-api";
import { athleteResultsHref } from "@/lib/athlete-results-route";
import { SessionAthleteRow } from "@/components/schedule-details/SessionAthleteRow";
import { SessionAthletesFrame } from "@/components/schedule-details/SessionAthletesFrame";
import { sessionAthletesStyles as styles } from "@/components/schedule-details/sessionAthletesStyles";
import SessionSortControl from "@/components/schedule-details/sessionSort/SessionSortControl";
import { Button } from "@/components/ui/Button";
import { ThemedText } from "@/components/ui/ThemedText";
import type { MeetName } from "@/data/types/meet";
import { useAppColors } from "@/hooks/useAppColors";
import { useIsOffline } from "@/hooks/useIsOffline";
import type { UseMeetAthletesReturn } from "@/hooks/useMeetAthletes";
import { useRequirePremium } from "@/hooks/useRequirePremium";
import {
  useSessionAthleteBests,
  useSessionAthletesReadyLog,
} from "@/hooks/useSessionAthleteBests";
import { loadFailureCopy } from "@/lib/load-failure";
import {
  sortSessionAthletes,
  type SessionAthleteSortDirection,
  type SessionAthleteSortKey,
} from "@/lib/session-athlete-sort";
import {
  SESSION_SORT_OPTIONS,
  sessionSortLabel,
  toSessionAthletesByPlatform,
} from "@/lib/session-athletes-view";
import { createSessionDetailsDeepLink, normalizeDeepLinkHref } from "@/utils/deepLinks";
import { useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";

const PREMIUM_SIGN_IN_MESSAGE = "Sign in to access premium features.";

export default function SessionAthletes({
  sessionNumber,
  platform,
  meetId,
  athletesState,
}: {
  sessionNumber: number;
  platform: string;
  meetId: MeetName;
  athletesState: UseMeetAthletesReturn;
}) {
  const router = useRouter();
  const colors = useAppColors();
  const {
    athletes: sessionAthletes,
    isLoading,
    isRefreshing,
    loadError,
    refreshAthletes,
  } = athletesState;
  const [isOffline] = useIsOffline();
  const [sortKey, setSortKey] = useState<SessionAthleteSortKey>("entryTotal");
  const [sortDirection, setSortDirection] = useState<SessionAthleteSortDirection>("desc");
  const { requirePremium, requireAuth, access } = useRequirePremium();
  const isSubscribed = access === "granted";
  const returnPath = useMemo(() => {
    const href = normalizeDeepLinkHref(
      createSessionDetailsDeepLink({ meet: meetId, sessionNumber, platform }),
    );
    return typeof href === "string" ? href : "/shared-screens/schedule-details";
  }, [meetId, sessionNumber, platform]);
  const sessionKey = { meetId, sessionNumber, platform };

  useSessionAthletesReadyLog(sessionKey, isLoading, sessionAthletes.length);
  const athleteBests = useSessionAthleteBests(sessionKey, sessionAthletes, isSubscribed);

  const athletes = useMemo(
    () => toSessionAthletesByPlatform(platform, sessionAthletes),
    [platform, sessionAthletes],
  );

  const sortedAthletes = useMemo(() => {
    const entries = Object.entries(athletes).map(
      ([platformName, platformAthletes]) =>
        [
          platformName,
          sortSessionAthletes(platformAthletes, athleteBests, sortKey, sortDirection),
        ] as const,
    );
    return Object.fromEntries(entries);
  }, [athletes, athleteBests, sortKey, sortDirection]);

  const handleSortSelect = useCallback((key: SessionAthleteSortKey, direction: SessionAthleteSortDirection) => {
    setSortKey(key);
    setSortDirection(direction);
  }, []);

  const handleSortLockedPress = useCallback(() => {
    requirePremium({ feature: "sort-athletes", message: PREMIUM_SIGN_IN_MESSAGE, returnPath });
  }, [requirePremium, returnPath]);

  const handleUnlockBests = () => {
    requirePremium({ feature: "athlete-bests", message: PREMIUM_SIGN_IN_MESSAGE, returnPath });
  };

  const handleSeeAllResults = (request: AthleteRequest) => {
    const authResult = requireAuth({
      feature: "athlete-results",
      message: PREMIUM_SIGN_IN_MESSAGE,
      returnPath,
    });
    if (authResult === null || authResult === false) {
      return;
    }
    router.push(athleteResultsHref(request));
  };

  const sortControl = (
    <SessionSortControl
      isSubscribed={isSubscribed}
      sortLabel={sessionSortLabel(sortKey)}
      sortKey={sortKey}
      sortDirection={sortDirection}
      sortOptions={SESSION_SORT_OPTIONS}
      onSelect={handleSortSelect}
      onLockedPress={handleSortLockedPress}
    />
  );

  const loading = isLoading || (sessionAthletes.length === 0 && isRefreshing);

  if (!athletes[platform]?.length) {
    if (loading) {
      return (
        <SessionAthletesFrame colors={colors} sortControl={sortControl}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.secondaryText} />
            <ThemedText style={[styles.loadingText, { color: colors.secondaryText }]}>
              Loading athletes...
            </ThemedText>
          </View>
        </SessionAthletesFrame>
      );
    }
    if (loadError) {
      const failure = loadFailureCopy("session athletes", isOffline);
      return (
        <SessionAthletesFrame colors={colors}>
          <View style={styles.loadingContainer} testID="session-athletes-load-error">
            <ThemedText style={styles.athletesTitle}>{failure.title}</ThemedText>
            <ThemedText
              style={[styles.loadingText, { color: colors.secondaryText, textAlign: "center" }]}
            >
              {failure.message}
            </ThemedText>
            <Button
              title="Retry"
              onPress={() => {
                void refreshAthletes();
              }}
            />
          </View>
        </SessionAthletesFrame>
      );
    }
    if (!meetId) return null;
    return (
      <SessionAthletesFrame colors={colors}>
        <View style={styles.loadingContainer} testID="session-athletes-empty">
          <ThemedText
            style={[styles.loadingText, { color: colors.secondaryText, textAlign: "center" }]}
          >
            No athletes yet. They will appear here once the start list is published.
          </ThemedText>
        </View>
      </SessionAthletesFrame>
    );
  }

  return (
    <SessionAthletesFrame colors={colors} sortControl={sortControl}>
      {Object.entries(sortedAthletes).map(([platformKey, platformAthletes]) => (
        <View key={platformKey}>
          {platformAthletes.map((athlete, index) => (
            <SessionAthleteRow
              key={athlete.name}
              athlete={athlete}
              bests={athleteBests[athlete.name]}
              isSubscribed={isSubscribed}
              isLast={index === platformAthletes.length - 1}
              colors={colors}
              onUnlockBests={handleUnlockBests}
              onSeeAllResults={handleSeeAllResults}
            />
          ))}
        </View>
      ))}
    </SessionAthletesFrame>
  );
}
