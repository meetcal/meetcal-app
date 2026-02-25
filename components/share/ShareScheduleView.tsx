import { ThemedText } from "@/components/ui/ThemedText";
import { getPlatformColors } from "@/constants/Colors";
import { LiftResult } from "@/data/types/athletes";
import { compareStartTimes } from "@/lib/start-list-utils";
import {
  ShareBackgroundPresetId,
  ShareScheduleViewProps,
} from "@/types/start-list";
import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

const getPlatformColor = (platform: string): string => {
  const platformColors = getPlatformColors();
  const normalizedPlatform =
    platform.charAt(0).toUpperCase() + platform.slice(1).toLowerCase();
  return (
    platformColors[normalizedPlatform as keyof typeof platformColors] ||
    platformColors.Blue
  );
};

const formatTime = (time: string): string => {
  if (!time || typeof time !== "string") return "";
  if (time.includes("AM") || time.includes("PM")) return time;
  if (!time.includes(":")) return time;

  const parts = time.split(":");
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return time;

  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes.toString().padStart(2, "0")} ${period}`;
};

const formatDate = (dateString: string): string => {
  if (!dateString) return "";

  const isoDateMatch = dateString.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const formatOptions: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  };

  if (isoDateMatch) {
    const [, yearRaw, monthRaw, dayRaw] = isoDateMatch;
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    if (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(day)) {
      return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(
        "en-US",
        formatOptions,
      );
    }
  }

  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) return dateString;
  return parsed.toLocaleDateString("en-US", formatOptions);
};

type PresetVisual = {
  canvas: string;
  text: string;
  accent: string;
  divider: string;
  headerRow: string;
  platformText: string;
  isTransparent: boolean;
};

const getPresetVisual = (preset: ShareBackgroundPresetId): PresetVisual => {
  switch (preset) {
    case "transparent":
      return {
        canvas: "transparent",
        text: "#FFFFFF",
        accent: "#BAE6FD",
        divider: "rgba(255,255,255,0.65)",
        headerRow: "rgba(0,0,0,0.35)",
        platformText: "#FFFFFF",
        isTransparent: true,
      };
    case "white":
    default:
      return {
        canvas: "#FFFFFF",
        text: "#000000",
        accent: "#007AFF",
        divider: "#000000",
        headerRow: "#FAFAFA",
        platformText: "#FFFFFF",
        isTransparent: false,
      };
  }
};

export default function ShareScheduleView({
  filteredAthletes,
  schedule,
  selectedMeet,
  selectedClub,
  backgroundPreset = "white",
  getSessionDetails,
}: ShareScheduleViewProps) {
  const presetVisual = getPresetVisual(backgroundPreset);

  const athletesByDate = React.useMemo(() => {
    const grouped: {
      [key: string]: {
        athlete: LiftResult;
        startTime: string;
      }[];
    } = {};

    filteredAthletes.forEach((athlete) => {
      if (!athlete.session) return;

      const sessionDay = schedule.find((day) =>
        day.sessions.some((s) => s.number === athlete.session?.number),
      );

      if (!sessionDay) return;

      const sessionDetails = getSessionDetails(athlete.session.number);
      if (!sessionDetails) return;
      const platform = sessionDetails.platforms.find(
        (p) => p.platform === athlete.session?.platform,
      );
      const startTime = platform?.platformStartTime || sessionDetails.startTime;

      const dateKey = sessionDay.fullDate;
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }

      grouped[dateKey].push({ athlete, startTime });
    });

    return Object.entries(grouped)
      .map(([date, athletes]) => ({
        date,
        athletes: athletes.sort((a, b) => {
          const timeOrder = compareStartTimes(a.startTime, b.startTime);
          if (timeOrder !== 0) return timeOrder;
          return a.athlete.name.localeCompare(b.athlete.name);
        }),
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [filteredAthletes, schedule, getSessionDetails]);

  return (
    <View style={[styles.canvas, { backgroundColor: presetVisual.canvas }]}>
      <View style={styles.header}>
        <Text style={[styles.clubName, { color: presetVisual.text }]}>
          {selectedClub}
        </Text>
        <Text style={[styles.meetName, { color: presetVisual.accent }]}>
          {selectedMeet}
        </Text>
      </View>

      <View
        style={[
          styles.tableHeader,
          {
            backgroundColor: presetVisual.headerRow,
          },
        ]}
      >
        <View style={[styles.headerCell, styles.nameColumn]}>
          <ThemedText style={[styles.headerText, { color: presetVisual.text }]}>Name</ThemedText>
        </View>
        <View style={[styles.headerCell, styles.weightColumn]}>
          <ThemedText style={[styles.headerText, { color: presetVisual.text }]}>Weight Class</ThemedText>
        </View>
        <View style={[styles.headerCell, styles.sessionColumn]}>
          <ThemedText style={[styles.headerText, { color: presetVisual.text }]}>Session</ThemedText>
        </View>
        <View style={[styles.headerCell, styles.platformColumn]}>
          <ThemedText style={[styles.headerText, { color: presetVisual.text }]}>Platform</ThemedText>
        </View>
        <View style={[styles.headerCell, styles.dateColumn]}>
          <ThemedText style={[styles.headerText, { color: presetVisual.text }]}>Date</ThemedText>
        </View>
        <View style={[styles.headerCell, styles.timeColumn]}>
          <ThemedText style={[styles.headerText, { color: presetVisual.text }]}>Start Time</ThemedText>
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: presetVisual.divider }]} />

      <View style={styles.tableBody}>
        {athletesByDate.map((dateGroup, groupIndex) =>
          dateGroup.athletes.map((item, athleteIndex) => {
            const { athlete, startTime } = item;
            const sessionDay = schedule.find((day) =>
              day.sessions.some((s) => s.number === athlete.session?.number),
            );

            const isLastInGroup =
              athleteIndex === dateGroup.athletes.length - 1;
            const isLastGroup = groupIndex === athletesByDate.length - 1;

            return (
              <View key={`${athlete.name}-${athleteIndex}`}>
                <View style={styles.tableRow}>
                  <View style={[styles.cell, styles.nameColumn]}>
                    <ThemedText style={[styles.cellText, { color: presetVisual.text }]}>
                      {athlete.name}
                    </ThemedText>
                  </View>
                  <View style={[styles.cell, styles.weightColumn]}>
                    <ThemedText style={[styles.cellText, { color: presetVisual.text }]}>
                      {athlete.weightClass}
                    </ThemedText>
                  </View>
                  <View style={[styles.cell, styles.sessionColumn]}>
                    <ThemedText style={[styles.cellText, { color: presetVisual.text }]}>
                      {athlete.session?.number}
                    </ThemedText>
                  </View>
                  <View style={[styles.cell, styles.platformColumn]}>
                    <View
                      style={[
                        styles.platformBadge,
                        {
                          backgroundColor: getPlatformColor(
                            athlete.session?.platform || "",
                          ),
                        },
                      ]}
                    >
                      <ThemedText
                        style={[
                          styles.platformText,
                          {
                            color: presetVisual.platformText,
                          },
                        ]}
                      >
                        {athlete.session?.platform}
                      </ThemedText>
                    </View>
                  </View>
                  <View style={[styles.cell, styles.dateColumn]}>
                    <ThemedText style={[styles.cellText, { color: presetVisual.text }]}>
                      {formatDate(sessionDay?.fullDate || "")}
                    </ThemedText>
                  </View>
                  <View style={[styles.cell, styles.timeColumn]}>
                    <ThemedText style={[styles.cellText, { color: presetVisual.text }]}>
                      {formatTime(startTime)}
                    </ThemedText>
                  </View>
                </View>

                {isLastInGroup && !isLastGroup && (
                  <View
                    style={[
                      styles.divider,
                      styles.groupDivider,
                      { backgroundColor: presetVisual.divider },
                    ]}
                  />
                )}
              </View>
            );
          }),
        )}
      </View>

      <View style={styles.footer}>
        <ThemedText style={[styles.footerText, { color: presetVisual.accent }]}>
          Generated by MeetCal
        </ThemedText>
        <Image
          source={require("@/assets/images/MeetCal-no-bg.png")}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    width: 850,
    paddingHorizontal: 0,
    paddingTop: 36,
    paddingBottom: 12,
    position: "relative",
  },
  header: {
    paddingTop: 8,
    paddingBottom: 16,
    paddingHorizontal: 12,
    alignItems: "center",
    gap: 8,
    width: "100%",
  },
  clubName: {
    fontSize: 28,
    lineHeight: 40,
    fontWeight: "bold",
    textAlign: "center",
  },
  meetName: {
    fontSize: 20,
    lineHeight: 30,
    fontWeight: "600",
    textAlign: "center",
  },
  tableHeader: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  headerCell: {
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: {
    fontSize: 14,
    fontWeight: "bold",
    textAlign: "center",
  },
  divider: {
    height: 1,
    marginBottom: 8,
  },
  groupDivider: {
    marginVertical: 8,
  },
  tableBody: {
    paddingBottom: 8,
  },
  tableRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 2,
  },
  cell: {
    alignItems: "center",
    justifyContent: "center",
  },
  cellText: {
    fontSize: 14,
    textAlign: "center",
  },
  nameColumn: {
    width: 280,
    alignItems: "flex-start",
    marginRight: 12,
  },
  weightColumn: {
    width: 110,
    marginRight: 12,
  },
  sessionColumn: {
    width: 75,
    marginRight: 12,
  },
  platformColumn: {
    width: 85,
    marginRight: 12,
  },
  dateColumn: {
    width: 105,
    marginRight: 12,
  },
  timeColumn: {
    width: 95,
  },
  platformBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    minWidth: 48,
    alignItems: "center",
  },
  platformText: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    paddingVertical: 18,
    marginTop: 6,
  },
  footerText: {
    fontSize: 14,
    fontWeight: "600",
  },
  logo: {
    width: 22,
    height: 22,
  },
});
