import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import {
  recordExpandTapTime,
  useExpandedId,
} from "@/contexts/ExpandedIdContext";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useTheme } from "@/contexts/ThemeContext";
import { getLastYearBests } from "@/lib/start-list-api";
import {
  calculateWeighInTime,
  formatSessionDisplayDate,
  getChevronIcon,
  isMeetName,
} from "@/lib/start-list-utils";
import { AthleteItemProps } from "@/types/start-list";
import { useAuthGuard } from "@/utils/authGuard";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  InteractionManager,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

export const AthleteItem = React.memo(function AthleteItem({
  athlete,
  router,
  getSessionDetails,
  onExpand,
  index,
}: AthleteItemProps) {
  const { currentTheme } = useTheme();
  const { expandedId, setExpandedId } = useExpandedId();
  const expandKey = `${athlete.memberId}_${athlete.name}`;
  const isExpanded = expandedId === expandKey;
  const tapTimeRef = useRef(0);
  const expandRenderLogged = useRef(false);
  const expandCommitLogged = useRef(false);
  const onPress = useCallback(() => {
    tapTimeRef.current = performance.now();
    if (__DEV__) recordExpandTapTime();
    const willExpand = expandedId !== expandKey;
    setExpandedId(willExpand ? expandKey : null);
    if (willExpand && onExpand && index != null) {
      setTimeout(() => onExpand(index), 50);
    }
    if (__DEV__)
      console.log(
        "[StartList] 0. setExpandedId called",
        Math.round(performance.now() - tapTimeRef.current),
        "ms since tap",
      );
  }, [expandKey, expandedId, setExpandedId, onExpand, index]);
  if (__DEV__ && isExpanded && !expandRenderLogged.current) {
    expandRenderLogged.current = true;
    console.log(
      "[StartList] 2. AthleteItem expanded render",
      Math.round(performance.now() - tapTimeRef.current),
      "ms since tap",
    );
  }
  if (__DEV__ && !isExpanded) {
    expandRenderLogged.current = false;
    expandCommitLogged.current = false;
  }
  const [yearBests, setYearBests] = useState({
    bestSnatch: 0,
    bestCJ: 0,
    bestTotal: 0,
  });
  const [loadingBests, setLoadingBests] = useState(true);
  const { selectedMeet, meetDetails } = useSelectedMeet();
  const { isSubscribed } = useSubscription();
  const { requireAuth } = useAuthGuard();
  const validMeet =
    selectedMeet && isMeetName(selectedMeet) ? selectedMeet : null;

  const timeZoneAbbr = useMemo(() => {
    if (!meetDetails?.time.timeZoneIdentifier) return "";
    const date = new Date();
    return (
      new Intl.DateTimeFormat("en-US", {
        timeZone: meetDetails.time.timeZoneIdentifier,
        timeZoneName: "short",
      })
        .formatToParts(date)
        .find((part) => part.type === "timeZoneName")?.value || ""
    );
  }, [meetDetails?.time.timeZoneIdentifier]);

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
    if (__DEV__ && !expandCommitLogged.current) {
      expandCommitLogged.current = true;
      console.log(
        "[StartList] 3. AthleteItem expanded committed (after paint)",
        Math.round(performance.now() - tapTimeRef.current),
        "ms since tap",
      );
    }
    const task = InteractionManager.runAfterInteractions(() => {
      setLoadingBests(true);
      getLastYearBests(athlete.name)
        .then((bests) => {
          setYearBests(bests);
          setLoadingBests(false);
        })
        .catch((err) => {
          if (__DEV__)
            console.warn("[AthleteItem] getLastYearBests failed", err);
          setYearBests({ bestSnatch: 0, bestCJ: 0, bestTotal: 0 });
          setLoadingBests(false);
        });
    });
    return () => task.cancel();
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
      weighInTime = startTime
        ? (calculateWeighInTime(startTime) ?? details?.weighInTime ?? "")
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
        <View
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
                    Session {athlete.session.number} •{" "}
                    {athlete.session.platform} Platform
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
                      meetDetails?.time.timeZoneIdentifier,
                    )}{" "}
                    •{" "}
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
            onPress={() => {
              // 1. Check auth
              const authResult = requireAuth({
                feature: "athlete-results",
                message: "Sign in to access premium features.",
                returnPath: "/(tabs)/(start-list)",
              });
              if (authResult === null) {
                // Still loading auth state
                return;
              }
              if (authResult === false) {
                // User not authenticated, alert already shown
                return;
              }
              // 2. Check subscription
              if (isSubscribed === true) {
                router.push({
                  pathname: "/shared-screens/athlete-results",
                  params: {
                    name: athlete.name,
                    ...(validMeet ? { meet: validMeet } : {}),
                  },
                });
              } else if (isSubscribed === false) {
                router.push({
                  pathname: "/shared-screens/paywall",
                  params: {
                    from: "/(tabs)/(start-list)",
                    feature: "athlete-results",
                  },
                } as any);
              }
            }}
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
        </View>
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
