import { Card } from "@/components/ui/Card";
import { Radius, Spacing, Type } from "@/constants/Layout";
import { Meet, MeetName } from "@/data/types/meet";
import { useAppColors } from "@/hooks/useAppColors";
import { SavedSession } from "@/hooks/useSavedSessions";
import { convertToUTC } from "@/data/meets/config";
import { getDateInTimeZone, getTimeZoneAbbreviation } from "@/utils/dateTime";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { ThemedText } from "@/components/ui/ThemedText";

// Show the card for sessions starting in the future, and keep it visible for a
// short grace window (30 min) after a session starts so an in-progress session
// still surfaces.
const STARTED_GRACE_MS = 30 * 60 * 1000;

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

/**
 * Today's calendar date (YYYY-MM-DD) in the meet's timezone. Reuses
 * getDateInTimeZone so we don't duplicate timezone math.
 */
function getTodayInMeetTimeZone(timeZone: string): string {
  const localMidnight = getDateInTimeZone(timeZone);
  return `${localMidnight.getFullYear()}-${pad(localMidnight.getMonth() + 1)}-${pad(
    localMidnight.getDate(),
  )}`;
}

/**
 * The meet is "today / ongoing" when its backend status says so, or when the
 * current date in the meet's timezone falls within the meet's date range.
 */
function isMeetTodayOrOngoing(meetDetails: Meet, timeZone: string): boolean {
  if (meetDetails.status === "ongoing") return true;
  const today = getTodayInMeetTimeZone(timeZone);
  const start = (meetDetails.dates?.start ?? "").slice(0, 10);
  const end = (meetDetails.dates?.end ?? "").slice(0, 10);
  if (!start || !end) return false;
  return today >= start && today <= end;
}

function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "in progress";
  const totalMinutes = Math.floor(msRemaining / 60000);
  if (totalMinutes === 0) return "in <1m";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  return `in ${minutes}m`;
}

type NextSessionCardProps = {
  selectedMeet: MeetName | null;
  meetDetails: Meet | null;
  savedSessions: SavedSession[];
  /** Extra spacing applied to the outer wrapper. Collapses when nothing renders. */
  style?: StyleProp<ViewStyle>;
};

export function NextSessionCard({
  selectedMeet,
  meetDetails,
  savedSessions,
  style,
}: NextSessionCardProps) {
  const colors = useAppColors();
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());

  // Tick once per minute while the screen is focused; cleared on blur/unmount.
  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
      const interval = setInterval(() => setNow(Date.now()), 60 * 1000);
      return () => clearInterval(interval);
    }, []),
  );

  const timeZoneIdentifier = meetDetails?.time.timeZoneIdentifier ?? "";
  const timeZoneAbbr = useMemo(
    () => (timeZoneIdentifier ? getTimeZoneAbbreviation(timeZoneIdentifier) : ""),
    [timeZoneIdentifier],
  );

  // Find the soonest saved session for this meet that is still upcoming (or
  // started within the grace window). Uses the shared convertToUTC timezone
  // math rather than re-deriving instants.
  const nextSession = useMemo(() => {
    if (!selectedMeet || !meetDetails || !timeZoneIdentifier) return null;
    if (!isMeetTodayOrOngoing(meetDetails, timeZoneIdentifier)) return null;

    let best: { session: SavedSession; startMs: number } | null = null;
    for (const session of savedSessions) {
      if (session.meet !== selectedMeet) continue;
      if (!session.startTime || !session.date) continue;

      let startMs: number;
      try {
        startMs = convertToUTC(
          session.startTime,
          session.date,
          timeZoneIdentifier,
        ).getTime();
      } catch {
        continue;
      }
      if (Number.isNaN(startMs)) continue;
      if (startMs <= now - STARTED_GRACE_MS) continue;

      if (!best || startMs < best.startMs) {
        best = { session, startMs };
      }
    }
    return best;
  }, [savedSessions, selectedMeet, meetDetails, timeZoneIdentifier, now]);

  if (!nextSession) return null;

  const { session, startMs } = nextSession;
  const msRemaining = startMs - now;
  const countdownLabel =
    msRemaining <= 0 ? "in progress" : `starts ${formatCountdown(msRemaining)}`;
  const weighInLabel = session.weighInTime
    ? `weigh-in ${session.weighInTime}${timeZoneAbbr ? ` ${timeZoneAbbr}` : ""}`
    : "";

  const handlePress = () => {
    router.push({
      pathname: "/shared-screens/schedule-details",
      params: {
        id: session.id,
        sessionNumber: session.sessionNumber.toString(),
        platform: session.platform,
        weightClass: session.weightClass,
        startTime: session.startTime,
        weighInTime: session.weighInTime,
        date: session.date,
        meet: session.meet,
      },
    });
  };

  return (
    <Animated.View entering={FadeInDown.duration(400)} style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Your next session: Session ${session.sessionNumber} on ${session.platform} platform, ${countdownLabel}`}
        onPress={handlePress}
      >
        {({ pressed }) => (
          <Card
            padded={false}
            style={[styles.card, pressed && { opacity: 0.85 }]}
          >
            <View style={styles.row}>
              <LinearGradient
                colors={[colors.link, colors.totalColor]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={styles.accent}
              />
              <View style={styles.content}>
                <ThemedText
                  style={[styles.eyebrow, { color: colors.secondaryText }]}
                >
                  YOUR NEXT SESSION
                </ThemedText>
                <ThemedText style={[styles.title, { color: colors.text }]}>
                  {`Session ${session.sessionNumber}${
                    session.platform ? ` · ${session.platform} platform` : ""
                  }`}
                </ThemedText>
                <View style={styles.metaRow}>
                  {weighInLabel ? (
                    <ThemedText
                      style={[styles.meta, { color: colors.secondaryText }]}
                    >
                      {weighInLabel}
                    </ThemedText>
                  ) : null}
                  {weighInLabel ? (
                    <ThemedText
                      style={[styles.dot, { color: colors.secondaryText }]}
                    >
                      ·
                    </ThemedText>
                  ) : null}
                  <ThemedText style={[styles.countdown, { color: colors.link }]}>
                    {countdownLabel}
                  </ThemedText>
                </View>
              </View>
            </View>
          </Card>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: Spacing.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  accent: {
    width: 4,
    borderTopLeftRadius: Radius.md,
    borderBottomLeftRadius: Radius.md,
  },
  content: {
    flex: 1,
    padding: Spacing.lg,
  },
  eyebrow: {
    ...Type.caption,
    fontWeight: "700",
    letterSpacing: 0.6,
    marginBottom: Spacing.xs,
  },
  title: {
    ...Type.bodySemiBold,
    marginBottom: Spacing.xs,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: Spacing.xs,
  },
  meta: {
    ...Type.caption,
  },
  dot: {
    ...Type.caption,
  },
  countdown: {
    ...Type.caption,
    fontWeight: "700",
  },
});
