import { ThemedText } from "@/components/ui/ThemedText";
import { getPlatformColors } from "@/constants/Colors";
import { MeetName, isMeetName } from "@/data/types/meet";
import { useAppColors } from "@/hooks/useAppColors";
import { SavedSession } from "@/hooks/useSavedSessions";
import { makeLookupKey } from "@/utils/session";
import { calculateWeighInTime } from "@/utils/time";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

// Add a type that extends SavedSession to include the legacy athleteName property
interface LegacySavedSession extends SavedSession {
  athleteName?: string;
}

type SessionScheduleLookup = {
  displayDate: string;
  fullDate: string;
  startTime: string;
  weighInTime: string;
  weightClass: string;
};

interface SessionCardProps {
  item: LegacySavedSession;
  selectedMeet: MeetName | null;
  onPress: () => void;
  sessionLookupByMeet: Map<MeetName, Map<string, SessionScheduleLookup>>;
  allowedMeetNames: ReadonlySet<string>;
  timeZoneIdentifier?: string;
  timeZoneAbbr: string;
}

const SessionCard = React.memo<SessionCardProps>(
  ({
    item,
    selectedMeet,
    onPress,
    sessionLookupByMeet,
    allowedMeetNames,
    timeZoneIdentifier,
    timeZoneAbbr,
  }) => {
    // Ensure meet is defined before using it
    const meet = item.meet || selectedMeet;
    if (!meet || !isMeetName(meet, allowedMeetNames)) {
      console.warn(
        "[SessionCard] No valid meet information available for session:",
        item,
      );
      return null;
    }

    const sessionNumber = item.sessionNumber?.toString() || "";
    const platform = item.platform || "";
    const lookup = sessionLookupByMeet
      .get(meet)
      ?.get(makeLookupKey(sessionNumber, platform));
    const weightClass = lookup?.weightClass || item.weightClass || "";
    const startTime = lookup?.startTime || item.startTime || "";
    const weighInTime =
      lookup?.weighInTime ||
      (startTime ? calculateWeighInTime(startTime) : item.weighInTime || "");
    const displayDate =
      lookup?.displayDate ||
      (item.date
        ? new Date(`${item.date}T12:00:00`).toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
            timeZone: timeZoneIdentifier || "UTC",
          })
        : "Date TBD");

    const colors = useAppColors();

    // Format time with the correct timezone abbreviation
    const formatTime = (time: string) => {
      if (!time) return "TBD";
      if (!timeZoneAbbr) return time;
      return `${time} ${timeZoneAbbr}`;
    };

    return (
      <Pressable
        style={({ pressed }) => [
          styles.sessionContainer,
          { backgroundColor: colors.card },
          pressed && { backgroundColor: colors.pressed },
        ]}
        onPress={onPress}
      >
        <ThemedText style={[styles.sessionTitle, { color: colors.text }]}>
          {/* Use displayDate derived from schedule map */}
          Session {sessionNumber}{" "}
          {displayDate !== "Date TBD" ? `• ${displayDate}` : ""}
        </ThemedText>

        {meet && meet !== selectedMeet && (
          <ThemedText
            style={[styles.meetName, { color: colors.secondaryText }]}
          >
            {meet.replace(/-/g, " ")}
          </ThemedText>
        )}

        <View style={styles.timeContainer}>
          <View style={styles.timeRow}>
            <View style={styles.timeBlock}>
              <ThemedText
                style={[styles.timeLabel, { color: colors.secondaryText }]}
              >
                Weigh-in:
              </ThemedText>
              <ThemedText
                style={[styles.timeText, { color: colors.secondaryText }]}
              >
                {formatTime(weighInTime)}
              </ThemedText>
            </View>
            <View style={styles.timeSeparator} />
            <View style={styles.timeBlock}>
              <ThemedText
                style={[styles.timeLabel, { color: colors.secondaryText }]}
              >
                Start:
              </ThemedText>
              <ThemedText
                style={[styles.timeText, { color: colors.secondaryText }]}
              >
                {formatTime(startTime)}
              </ThemedText>
            </View>
          </View>
        </View>

        <View
          style={[styles.platformContainer, { backgroundColor: colors.card }]}
        >
          <View
            style={[
              styles.platformIndicator,
              {
                backgroundColor:
                  getPlatformColors()[
                    platform as keyof ReturnType<typeof getPlatformColors>
                  ],
              },
            ]}
          >
            <ThemedText style={styles.platformText}>{platform}</ThemedText>
          </View>
          <ThemedText
            style={[styles.weightClassText, { color: colors.secondaryText }]}
          >
            {weightClass}
          </ThemedText>
        </View>

        {/* Display athlete names if available (saved from start list) */}
        {item.athleteNames &&
          Array.isArray(item.athleteNames) &&
          item.athleteNames.length > 0 && (
            <View
              style={[
                styles.athleteContainer,
                { borderTopColor: colors.border },
              ]}
            >
              <ThemedText
                style={[styles.athleteLabel, { color: colors.secondaryText }]}
              >
                {item.athleteNames.length === 1 ? "Athlete:" : "Athletes:"}
              </ThemedText>
              <View style={styles.athleteNamesContainer}>
                {item.athleteNames.slice(0, 3).map((name, index) => (
                  <View key={index} style={styles.athleteRow}>
                    <ThemedText
                      style={[styles.athleteName, { color: colors.text }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {name}
                    </ThemedText>
                  </View>
                ))}
                {item.athleteNames.length > 3 && (
                  <ThemedText
                    style={[
                      styles.athleteMoreText,
                      { color: colors.secondaryText },
                    ]}
                  >
                    +{item.athleteNames.length - 3} more
                  </ThemedText>
                )}
              </View>
            </View>
          )}

        {/* For backward compatibility with old saved sessions */}
        {!item.athleteNames && item.athleteName && (
          <View
            style={[styles.athleteContainer, { borderTopColor: colors.border }]}
          >
            <ThemedText
              style={[styles.athleteLabel, { color: colors.secondaryText }]}
            >
              Athlete:
            </ThemedText>
            <View style={styles.athleteRow}>
              <ThemedText style={[styles.athleteName, { color: colors.text }]}>
                {item.athleteName}
              </ThemedText>
            </View>
          </View>
        )}

        {/* Display notes if available */}
        {item.notes && item.notes.length > 0 && (
          <View
            style={[styles.notesContainer, { borderTopColor: colors.border }]}
          >
            <ThemedText
              style={[styles.notesLabel, { color: colors.secondaryText }]}
            >
              Notes:
            </ThemedText>
            {item.notes
              .split("\n\n")
              .filter((note) => note.trim().length > 0)
              .map((note, index, array) => (
                <View key={index} style={styles.noteBlock}>
                  <ThemedText
                    style={[styles.notesText, { color: colors.text }]}
                  >
                    {note.trim()}
                  </ThemedText>
                  {index < array.length - 1 && (
                    <View
                      style={[
                        styles.noteDivider,
                        { backgroundColor: colors.border },
                      ]}
                    />
                  )}
                </View>
              ))}
          </View>
        )}
      </Pressable>
    );
  },
);

SessionCard.displayName = "SessionCard";

export default SessionCard;

const styles = StyleSheet.create({
  sessionContainer: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  sessionTitle: {
    fontSize: 17,
    fontWeight: "600",
    padding: 16,
    paddingBottom: 0,
  },
  timeContainer: {
    padding: 16,
    paddingTop: 8,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  timeBlock: {
    flexDirection: "row",
    alignItems: "center",
  },
  timeSeparator: {
    width: 24,
  },
  timeLabel: {
    fontSize: 14,
    color: "#666",
    marginRight: 4,
  },
  timeText: {
    fontSize: 15,
    color: "#666",
  },
  platformContainer: {
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    overflow: "hidden",
    margin: 16,
    marginTop: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  platformIndicator: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  platformText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "600",
  },
  weightClassText: {
    fontSize: 15,
    color: "#666",
  },
  athleteContainer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E1E1E1",
  },
  athleteLabel: {
    fontSize: 14,
    marginBottom: 4,
  },
  athleteNamesContainer: {
    flexDirection: "column",
    gap: 4,
    width: "100%",
  },
  athleteName: {
    fontSize: 15,
    fontWeight: "600",
    flexShrink: 1,
  },
  athleteMoreText: {
    fontSize: 14,
    fontStyle: "italic",
  },
  meetName: {
    fontSize: 14,
    fontStyle: "italic",
    marginLeft: 16,
    marginTop: 4,
  },
  athleteRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
  notesContainer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  notesLabel: {
    fontSize: 14,
    marginBottom: 12,
    color: "#8E8E93",
  },
  notesText: {
    fontSize: 15,
    lineHeight: 20,
  },
  noteBlock: {
    marginBottom: 12,
  },
  noteDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },
});
