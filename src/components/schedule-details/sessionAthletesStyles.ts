import { Palette } from "@/constants/Palette";
import { StyleSheet } from "react-native";

export const sessionAthletesStyles = StyleSheet.create({
  card: {
    borderRadius: 12,
    marginBottom: 16,
    overflow: "hidden",
  },
  athletesTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  titleSection: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  athleteSection: {
    padding: 16,
  },
  athleteHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  athleteName: {
    fontSize: 17,
    fontWeight: "600",
  },
  athleteDetail: {
    fontSize: 15,
    marginBottom: 2,
  },
  statsRow: {
    flexDirection: "row",
    marginTop: 8,
    gap: 16,
  },
  statItem: {
    flex: 1,
  },
  statLabel: {
    fontSize: 13,
    marginBottom: 2,
  },
  statValue: {
    fontSize: 15,
    fontWeight: "500",
  },
  meetResultsButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
  },
  meetResultsText: {
    fontSize: 15,
    fontWeight: "500",
    color: Palette.systemBlue,
  },
  loadingContainer: {
    padding: 32,
    alignItems: "center",
    gap: 16,
  },
  loadingText: {
    fontSize: 15,
  },
  premiumStatsContainer: {
    flex: 3,
    flexDirection: "column",
    gap: 2,
  },
  premiumLabelsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  premiumStatLabel: {
    flex: 1,
    textAlign: "center",
  },
  premiumUnlockBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Palette.systemBlue,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginTop: 4,
  },
  premiumUnlockText: {
    color: Palette.white,
    fontSize: 13,
    fontWeight: "600",
  },
});
