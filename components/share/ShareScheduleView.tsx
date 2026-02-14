import { ThemedText } from "@/components/ui/ThemedText";
import { getPlatformColors } from "@/constants/Colors";
import { LiftResult } from "@/data/types/athletes";
import { ShareScheduleViewProps } from "@/types/start-list";
import React from "react";
import { Image, StyleSheet, View } from "react-native";

const getPlatformColor = (platform: string): string => {
  const platformColors = getPlatformColors();
  const normalizedPlatform =
    platform.charAt(0).toUpperCase() + platform.slice(1).toLowerCase();
  return platformColors[normalizedPlatform as keyof typeof platformColors] || platformColors.Blue;
};

// Format time from HH:mm:ss or h:mm a format
const formatTime = (time: string): string => {
  if (!time || typeof time !== "string") return "";

  // If already in 12-hour format, return as is
  if (time.includes("AM") || time.includes("PM")) {
    return time;
  }

  if (!time.includes(":")) return time;

  // Parse 24-hour format
  const parts = time.split(":");
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return time;

  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes.toString().padStart(2, "0")} ${period}`;
};

// Format schedule date without shifting the calendar day by local timezone.
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

export default function ShareScheduleView({
  filteredAthletes,
  schedule,
  selectedMeet,
  selectedClub,
  transparentBackground = false,
  getSessionDetails,
}: ShareScheduleViewProps) {
  // Group athletes by date and sort
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

    // Sort by date and then by start time
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
    <View
      style={[
        styles.container,
        transparentBackground && styles.containerTransparent,
      ]}
    >
      {/* Header */}
      <View style={styles.header}>
        <ThemedText style={styles.clubName}>{selectedClub}</ThemedText>
        <ThemedText style={styles.meetName}>{selectedMeet}</ThemedText>
      </View>

      {/* Table Headers */}
      <View style={styles.tableHeader}>
        <View style={[styles.headerCell, styles.nameColumn]}>
          <ThemedText style={styles.headerText}>Name</ThemedText>
        </View>
        <View style={[styles.headerCell, styles.weightColumn]}>
          <ThemedText style={styles.headerText}>Weight Class</ThemedText>
        </View>
        <View style={[styles.headerCell, styles.sessionColumn]}>
          <ThemedText style={styles.headerText}>Session</ThemedText>
        </View>
        <View style={[styles.headerCell, styles.platformColumn]}>
          <ThemedText style={styles.headerText}>Platform</ThemedText>
        </View>
        <View style={[styles.headerCell, styles.dateColumn]}>
          <ThemedText style={styles.headerText}>Date</ThemedText>
        </View>
        <View style={[styles.headerCell, styles.timeColumn]}>
          <ThemedText style={styles.headerText}>Start Time</ThemedText>
        </View>
      </View>

      <View style={styles.divider} />

      {/* Table Rows */}
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
                    <ThemedText style={styles.cellText}>
                      {athlete.name}
                    </ThemedText>
                  </View>
                  <View style={[styles.cell, styles.weightColumn]}>
                    <ThemedText style={styles.cellText}>
                      {athlete.weightClass}
                    </ThemedText>
                  </View>
                  <View style={[styles.cell, styles.sessionColumn]}>
                    <ThemedText style={styles.cellText}>
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
                      <ThemedText style={styles.platformText}>
                        {athlete.session?.platform}
                      </ThemedText>
                    </View>
                  </View>
                  <View style={[styles.cell, styles.dateColumn]}>
                    <ThemedText style={styles.cellText}>
                      {formatDate(sessionDay?.fullDate || "")}
                    </ThemedText>
                  </View>
                  <View style={[styles.cell, styles.timeColumn]}>
                    <ThemedText style={styles.cellText}>
                      {formatTime(startTime)}
                    </ThemedText>
                  </View>
                </View>

                {/* Add divider between date groups */}
                {isLastInGroup && !isLastGroup && (
                  <View style={[styles.divider, styles.groupDivider]} />
                )}
              </View>
            );
          }),
        )}
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <ThemedText style={styles.footerText}>Generated by MeetCal</ThemedText>
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
  container: {
    width: 850,
    backgroundColor: "#FFFFFF",
    paddingTop: 40,
  },
  containerTransparent: {
    backgroundColor: "transparent",
  },
  header: {
    paddingVertical: 30,
    alignItems: "center",
    gap: 8,
    width: "100%",
  },
  clubName: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#000000",
    textAlign: "center",
  },
  meetName: {
    fontSize: 20,
    fontWeight: "600",
    color: "#007AFF",
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
    color: "#000000",
    textAlign: "center",
  },
  divider: {
    height: 1,
    backgroundColor: "#000000",
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
    color: "#000000",
    textAlign: "center",
  },
  // Column widths - evenly distributed
  // Total width: 850 - 24 (padding) = 826
  // 5 gaps at 12px each = 60
  // Available for columns: 766px
  // Name gets more space, rest distributed evenly
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
    borderRadius: 10,
    minWidth: 60,
    alignItems: "center",
  },
  platformText: {
    fontSize: 14,
    color: "#FFFFFF",
    fontWeight: "500",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 20,
    gap: 8,
  },
  footerText: {
    fontSize: 12,
    color: "#8E8E93",
  },
  logo: {
    width: 40,
    height: 40,
    backgroundColor: "transparent",
  },
});
