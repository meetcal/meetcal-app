import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { useExpandedRow } from "@/contexts/ExpandedIdContext";
import type { MeetName } from "@/data/types/meet";
import { getLastYearBests } from "@/lib/start-list-api";
import {
  formatSessionDisplayDate,
  getChevronIcon,
} from "@/lib/start-list-utils";
import { calculateWeighInTime } from "@/utils/time";
import { AthleteItemProps } from "@/types/start-list";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

/**
 * Everything a row needs from the app's contexts, resolved once by the screen.
 *
 * This is the FlashList row for a roster that runs to 1,500 athletes. It used
 * to call `useAuthGuard()` (a SecureStore read, a NetInfo probe and a
 * SecureStore write, in effects) and subscribe to `useSelectedMeet`,
 * `useSubscription` and `useTheme` itself — per mounted row, on every recycle.
 * `requireAuth` is needed for exactly one press, so the screen resolves the
 * guard and the context values once and hands them down. Keep this component
 * free of context reads so `React.memo` decides its re-renders on props alone.
 */
export interface AthleteRowProps extends AthleteItemProps {
  currentTheme: "light" | "dark";
  /** The selected meet, or null when none / not a known meet name. */
  validMeet: MeetName | null;
  /** `meetDetails.time.abbreviation`, resolved at the meet's own start date. */
  timeZoneAbbr: string;
  timeZoneIdentifier: string | undefined;
  isSubscribed: boolean | null;
  /** Runs the auth + subscription gate and navigates; owned by the screen. */
  onSeeAllResults: (athleteName: string) => void;
}

export const AthleteItem = React.memo(function AthleteItem({
  athlete,
  router,
  getSessionDetails,
  onExpand,
  index,
  currentTheme,
  validMeet,
  timeZoneAbbr,
  timeZoneIdentifier,
  isSubscribed,
  onSeeAllResults,
}: AthleteRowProps) {
  const expandKey = `${athlete.memberId}_${athlete.name}`;
  const { isExpanded, toggle } = useExpandedRow(expandKey);
  const onPress = useCallback(() => {
    const willExpand = toggle();
    if (willExpand && onExpand && index != null) {
      setTimeout(() => onExpand(index), 50);
    }
  }, [toggle, onExpand, index]);
  const [yearBests, setYearBests] = useState({
    bestSnatch: 0,
    bestCJ: 0,
    bestTotal: 0,
  });
  const [loadingBests, setLoadingBests] = useState(true);

  const colors = useMemo(
    () => ({
      card: currentTheme === "dark" ? "#1C1C1E" : "#FFFFFF",
      border: currentTheme === "dark" ? "#38383A" : "#E1E1E1",
      text: currentTheme === "dark" ? "#FFFFFF" : "#000000",
      secondaryText: currentTheme === "dark" ? "#8E8E93" : "#6B6B6B",
      pressed: currentTheme === "dark" ? "#2C2C2E" : "#F5F5F5",
    }),
    [currentTheme],
  );

  useEffect(() => {
    if (!isExpanded) return;
    // RN 0.88 removed InteractionManager from core; idle callbacks are the
    // replacement for deferring work until after the expand animation paints.
    // The timeout is the safety net InteractionManager gave us for free: an
    // idle period is never guaranteed (a list that is scrolled continuously
    // never yields one), and without it the row would spin forever.
    let cancelled = false;
    const handle = requestIdleCallback(
      () => {
        if (cancelled) return;
        setLoadingBests(true);
        getLastYearBests(athlete.name)
          .then((bests) => {
            if (cancelled) return;
            setYearBests(bests);
            setLoadingBests(false);
          })
          .catch((err) => {
            if (cancelled) return;
            if (__DEV__)
              console.warn("[AthleteItem] getLastYearBests failed", err);
            setYearBests({ bestSnatch: 0, bestCJ: 0, bestTotal: 0 });
            setLoadingBests(false);
          });
      },
      { timeout: 500 },
    );
    return () => {
      cancelled = true;
      cancelIdleCallback(handle);
    };
  }, [isExpanded, athlete.name]);

  const handleSessionPress = useCallback(() => {
    if (!athlete.session) return;
    const hasEmbedded =
      athlete.session.date != null &&
      athlete.session.startTime != null &&
      athlete.session.weighInTime != null;
    let startTime: string;
    let weighInTime: string;
    let dateStr: string;
    if (hasEmbedded) {
      startTime = athlete.session.startTime!;
      weighInTime = athlete.session.weighInTime!;
      dateStr = athlete.session.date!;
    } else {
      const details = getSessionDetails(athlete.session.number);
      const platform = details?.platforms.find(
        (p) => p.platform === athlete.session?.platform,
      );
      startTime = platform?.platformStartTime || details?.startTime || "";
      // `calculateWeighInTime` returns "" (not null) when it cannot parse, so
      // the fallback has to be `||`.
      weighInTime = startTime
        ? calculateWeighInTime(startTime) || details?.weighInTime || ""
        : details?.weighInTime || "";
      dateStr = details?.date || "";
    }
    if (!startTime || !weighInTime || !dateStr) return;
    router.push({
      pathname: "/shared-screens/schedule-details",
      params: {
        id: `session-${athlete.session.number}-${athlete.session.platform}`,
        sessionNumber: athlete.session.number,
        platform: athlete.session.platform,
        weightClass: athlete.weightClass,
        startTime,
        weighInTime,
        date: dateStr,
        athleteName: athlete.name,
        ...(validMeet ? { meet: validMeet } : {}),
      },
    });
  }, [athlete, getSessionDetails, router, validMeet]);

  const formatSessionTime = useCallback(
    (time: string | undefined | null) => {
      if (!time || !validMeet) return "TBD";
      return `${time} ${timeZoneAbbr}`;
    },
    [validMeet, timeZoneAbbr],
  );

  const handleSeeAllResults = useCallback(() => {
    onSeeAllResults(athlete.name);
  }, [onSeeAllResults, athlete.name]);

  return (
    <View style={[styles.athleteCard, { backgroundColor: colors.card }]}>
      <Pressable
        style={({ pressed }) => [
          styles.athleteButton,
          pressed && { backgroundColor: colors.pressed },
        ]}
        onPress={onPress}
      >
        <ThemedText style={styles.athleteName}>{athlete.name}</ThemedText>
        <IconSymbol
          name={getChevronIcon(isExpanded ? "down" : "right")}
          size={20}
          color={colors.secondaryText}
        />
      </Pressable>
      {isExpanded && (
        <Animated.View
          entering={FadeIn.duration(160)}
          style={[styles.detailsContainer, { borderTopColor: colors.border }]}
        >
          {athlete.session && (
            <>
              <Pressable
                style={({ pressed }) => [
                  styles.detailRow,
                  styles.sessionLink,
                  pressed && { backgroundColor: colors.pressed },
                ]}
                onPress={handleSessionPress}
              >
                <ThemedText
                  style={[styles.detailLabel, { color: colors.secondaryText }]}
                >
                  Session:
                </ThemedText>
                <View style={styles.sessionValueContainer}>
                  <ThemedText
                    style={[styles.detailValue, { color: "#007AFF" }]}
                  >
                    Session{" "}
                    {athlete.session.number}
                    {" "}
                    •{" "}
                    {athlete.session.platform}
                    {" "}
                    Platform
                  </ThemedText>
                  <IconSymbol
                    name={getChevronIcon("right")}
                    size={13}
                    color="#007AFF"
                  />
                </View>
              </Pressable>
              {(athlete.session.displayDate != null ||
                getSessionDetails(athlete.session.number)) && (
                <View style={styles.detailRow}>
                  <ThemedText
                    style={[
                      styles.detailLabel,
                      { color: colors.secondaryText },
                    ]}
                  >
                    Date & Time:
                  </ThemedText>
                  <ThemedText style={styles.detailValue}>
                    {formatSessionDisplayDate(
                      athlete.session.displayDate ??
                        getSessionDetails(athlete.session.number)?.displayDate,
                      athlete.session.date ??
                        getSessionDetails(athlete.session.number)?.date,
                      timeZoneIdentifier,
                    )}
{" "}
                    •
{" "}
                    {formatSessionTime(
                      athlete.session.startTime ??
                        getSessionDetails(
                          athlete.session.number,
                        )?.platforms.find(
                          (p) => p.platform === athlete.session?.platform,
                        )?.platformStartTime ??
                        getSessionDetails(athlete.session.number)?.startTime,
                    )}
                  </ThemedText>
                </View>
              )}
            </>
          )}
          <View style={[styles.detailRow, styles.wrappingDetailRow]}>
            <ThemedText
              style={[styles.detailLabel, { color: colors.secondaryText }]}
            >
              Club:
            </ThemedText>
            <View style={styles.wrappingDetailValue}>
              <ThemedText style={[styles.detailValue, styles.wrappingText]}>
                {athlete.club}
              </ThemedText>
            </View>
          </View>
          <View style={[styles.detailRow, styles.wrappingDetailRow]}>
            <ThemedText
              style={[styles.detailLabel, { color: colors.secondaryText }]}
            >
              Weight Class:
            </ThemedText>
            <View style={styles.wrappingDetailValue}>
              <ThemedText style={[styles.detailValue, styles.wrappingText]}>
                {athlete.weightClass}
              </ThemedText>
            </View>
          </View>
          <View style={styles.detailRow}>
            <ThemedText
              style={[styles.detailLabel, { color: colors.secondaryText }]}
            >
              Age:
            </ThemedText>
            <ThemedText style={styles.detailValue}>{athlete.age}</ThemedText>
          </View>
          <View style={styles.detailRow}>
            <ThemedText
              style={[styles.detailLabel, { color: colors.secondaryText }]}
            >
              Entry Total:
            </ThemedText>
            <ThemedText style={styles.detailValue}>
              {athlete.entryTotal}
              kg
            </ThemedText>
          </View>
          {isSubscribed && (
            <View
              style={[styles.statsContainer, { borderTopColor: colors.border }]}
            >
              <ThemedText
                style={[styles.statsTitle, { color: colors.secondaryText }]}
              >
                Bests From The Last Year
              </ThemedText>
              <View style={styles.statsRow}>
                {loadingBests ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.secondaryText}
                  />
                ) : (
                  <>
                    <View style={styles.statItem}>
                      <ThemedText
                        style={[
                          styles.statLabel,
                          { color: colors.secondaryText },
                        ]}
                      >
                        Snatch
                      </ThemedText>
                      <ThemedText style={styles.statValue}>
                        {yearBests.bestSnatch > 0
                          ? `${yearBests.bestSnatch}kg`
                          : "—"}
                      </ThemedText>
                    </View>
                    <View style={styles.statItem}>
                      <ThemedText
                        style={[
                          styles.statLabel,
                          { color: colors.secondaryText },
                        ]}
                      >
                        CJ
                      </ThemedText>
                      <ThemedText style={styles.statValue}>
                        {yearBests.bestCJ > 0 ? `${yearBests.bestCJ}kg` : "—"}
                      </ThemedText>
                    </View>
                    <View style={styles.statItem}>
                      <ThemedText
                        style={[
                          styles.statLabel,
                          { color: colors.secondaryText },
                        ]}
                      >
                        Total
                      </ThemedText>
                      <ThemedText style={styles.statValue}>
                        {yearBests.bestTotal > 0
                          ? `${yearBests.bestTotal}kg`
                          : "—"}
                      </ThemedText>
                    </View>
                  </>
                )}
              </View>
            </View>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.meetResultsButton,
              pressed && { opacity: 0.8 },
            ]}
            onPress={handleSeeAllResults}
          >
            <ThemedText style={styles.meetResultsText}>
              See All Meet Results
            </ThemedText>
            <IconSymbol
              name={getChevronIcon("right")}
              size={13}
              color="#007AFF"
            />
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  athleteCard: {
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    marginBottom: 12,
  },
  athleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
  },
  athleteName: {
    fontSize: 17,
    fontWeight: "400",
  },
  detailsContainer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  wrappingDetailRow: { alignItems: "flex-start" },
  detailLabel: { fontSize: 15, minWidth: 95 },
  detailValue: { fontSize: 15, fontWeight: "500" },
  wrappingDetailValue: { flex: 1 },
  wrappingText: { textAlign: "right", flexWrap: "wrap" },
  sessionLink: { borderRadius: 8, marginHorizontal: -8, paddingHorizontal: 8 },
  sessionValueContainer: { flexDirection: "row", alignItems: "center", gap: 4 },
  statsContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    position: "relative",
  },
  statsTitle: {
    fontSize: 16,
    fontWeight: "500",
    marginBottom: 8,
    textAlign: "center",
  },
  statsRow: {
    flexDirection: "row",
    gap: 16,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  statItem: { flex: 1, alignItems: "center" },
  statLabel: { fontSize: 13, marginBottom: 2, textAlign: "center" },
  statValue: { fontSize: 15, fontWeight: "500", textAlign: "center" },
  meetResultsButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  meetResultsText: { fontSize: 15, fontWeight: "500", color: "#007AFF" },
});
