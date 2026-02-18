import { ThemedText } from "@/components/ui/ThemedText";
import { getPlatformColors } from "@/constants/Colors";
import { LiftResult } from "@/data/types/athletes";
import {
  ShareBackgroundPresetId,
  ShareScheduleViewProps,
} from "@/types/start-list";
import React from "react";
import { Image, StyleSheet, View } from "react-native";

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
  card: string;
  cardBorder: string;
  text: string;
  accent: string;
  divider: string;
  headerRow: string;
  platformText: string;
  isTransparent: boolean;
  socialGlow?: {
    top: string;
    left: string;
    right: string;
  };
};

const getPresetVisual = (preset: ShareBackgroundPresetId): PresetVisual => {
  switch (preset) {
    case "soft-gray":
      return {
        canvas: "#EDF1F5",
        card: "#FFFFFF",
        cardBorder: "#D5DBE3",
        text: "#0F172A",
        accent: "#2563EB",
        divider: "#CBD5E1",
        headerRow: "#F8FAFC",
        platformText: "#FFFFFF",
        isTransparent: false,
      };
    case "high-contrast":
      return {
        canvas: "#0B1220",
        card: "#111827",
        cardBorder: "#334155",
        text: "#F8FAFC",
        accent: "#93C5FD",
        divider: "#334155",
        headerRow: "#1F2937",
        platformText: "#FFFFFF",
        isTransparent: false,
      };
    case "transparent":
      return {
        canvas: "transparent",
        card: "transparent",
        cardBorder: "transparent",
        text: "#FFFFFF",
        accent: "#BAE6FD",
        divider: "rgba(255,255,255,0.65)",
        headerRow: "rgba(0,0,0,0.35)",
        platformText: "#FFFFFF",
        isTransparent: true,
      };
    case "sunset":
      return {
        canvas: "#FFF7ED",
        card: "rgba(255,255,255,0.95)",
        cardBorder: "#FECACA",
        text: "#1F2937",
        accent: "#EA580C",
        divider: "#FDBA74",
        headerRow: "#FFF1E6",
        platformText: "#FFFFFF",
        isTransparent: false,
        socialGlow: {
          top: "rgba(251,113,133,0.28)",
          left: "rgba(251,146,60,0.24)",
          right: "rgba(244,114,182,0.24)",
        },
      };
    case "ocean":
      return {
        canvas: "#ECFEFF",
        card: "rgba(255,255,255,0.95)",
        cardBorder: "#99F6E4",
        text: "#0F172A",
        accent: "#0891B2",
        divider: "#67E8F9",
        headerRow: "#ECFEFF",
        platformText: "#FFFFFF",
        isTransparent: false,
        socialGlow: {
          top: "rgba(56,189,248,0.22)",
          left: "rgba(20,184,166,0.24)",
          right: "rgba(59,130,246,0.2)",
        },
      };
    case "neon-night":
      return {
        canvas: "#020617",
        card: "rgba(15,23,42,0.93)",
        cardBorder: "#334155",
        text: "#F8FAFC",
        accent: "#22D3EE",
        divider: "#334155",
        headerRow: "rgba(30,41,59,0.85)",
        platformText: "#FFFFFF",
        isTransparent: false,
        socialGlow: {
          top: "rgba(34,211,238,0.26)",
          left: "rgba(59,130,246,0.2)",
          right: "rgba(236,72,153,0.23)",
        },
      };
    case "white":
    default:
      return {
        canvas: "#FFFFFF",
        card: "#FFFFFF",
        cardBorder: "#E5E7EB",
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
      [key: string]: { athlete: LiftResult; sessionDetails: any }[];
    } = {};

    filteredAthletes.forEach((athlete) => {
      if (!athlete.session) return;

      const sessionDay = schedule.find((day) =>
        day.sessions.some((s) => s.number === athlete.session?.number),
      );

      if (!sessionDay) return;

      const sessionDetails = getSessionDetails(athlete.session.number);
      if (!sessionDetails) return;

      const dateKey = sessionDay.fullDate;
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }

      grouped[dateKey].push({ athlete, sessionDetails });
    });

    return Object.entries(grouped)
      .map(([date, athletes]) => ({
        date,
        athletes: athletes.sort((a, b) => {
          const timeA = a.sessionDetails.startTime;
          const timeB = b.sessionDetails.startTime;
          return timeA.localeCompare(timeB);
        }),
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [filteredAthletes, schedule, getSessionDetails]);

  return (
    <View style={[styles.canvas, { backgroundColor: presetVisual.canvas }]}>
      {presetVisual.socialGlow ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
          <View
            style={[styles.glowTop, { backgroundColor: presetVisual.socialGlow.top }]}
          />
          <View
            style={[styles.glowLeft, { backgroundColor: presetVisual.socialGlow.left }]}
          />
          <View
            style={[styles.glowRight, { backgroundColor: presetVisual.socialGlow.right }]}
          />
        </View>
      ) : null}

      <View
        style={[
          styles.container,
          !presetVisual.isTransparent && {
            backgroundColor: presetVisual.card,
            borderColor: presetVisual.cardBorder,
            borderWidth: 1,
          },
        ]}
      >
        <View style={styles.header}>
          <ThemedText style={[styles.clubName, { color: presetVisual.text }]}>
            {selectedClub}
          </ThemedText>
          <ThemedText style={[styles.meetName, { color: presetVisual.accent }]}> 
            {selectedMeet}
          </ThemedText>
        </View>

        <View
          style={[styles.tableHeader, { backgroundColor: presetVisual.headerRow }]}
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
              const { athlete, sessionDetails } = item;
              const sessionDay = schedule.find((day) =>
                day.sessions.some((s) => s.number === athlete.session?.number),
              );
              const session = sessionDay?.sessions.find(
                (s) => s.number === athlete.session?.number,
              );
              const platform = session?.platforms.find(
                (p) => p.platform === athlete.session?.platform,
              );
              const startTime =
                platform?.platformStartTime || sessionDetails.startTime;

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
                            { color: presetVisual.platformText },
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
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    width: 850,
    padding: 20,
    paddingTop: 28,
    position: "relative",
    overflow: "hidden",
  },
  container: {
    width: "100%",
    paddingTop: 24,
    borderRadius: 18,
  },
  glowTop: {
    position: "absolute",
    top: -120,
    left: 140,
    width: 540,
    height: 280,
    borderRadius: 140,
    transform: [{ rotate: "-6deg" }],
  },
  glowLeft: {
    position: "absolute",
    bottom: 120,
    left: -120,
    width: 300,
    height: 300,
    borderRadius: 160,
  },
  glowRight: {
    position: "absolute",
    bottom: -90,
    right: -60,
    width: 260,
    height: 260,
    borderRadius: 130,
  },
  header: {
    paddingVertical: 24,
    alignItems: "center",
    gap: 8,
    width: "100%",
  },
  clubName: {
    fontSize: 28,
    fontWeight: "bold",
    textAlign: "center",
  },
  meetName: {
    fontSize: 20,
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
