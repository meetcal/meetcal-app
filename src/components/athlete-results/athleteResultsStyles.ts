import { Palette } from "@/constants/Palette";
import { StyleSheet } from "react-native";

export const athleteResultsStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  card: {
    borderRadius: 12,
    marginBottom: 16,
    overflow: "hidden",
  },
  section: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  meetNameRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  meetName: {
    fontSize: 20,
    fontWeight: "600",
    flexShrink: 1,
  },
  prBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 8,
  },
  prBadgeText: {
    color: Palette.white,
    fontSize: 12,
    fontWeight: "700",
  },
  rateBarWrap: {
    marginBottom: 10,
  },
  meetDate: {
    fontSize: 15,
    marginBottom: 2,
  },
  weightClass: {
    fontSize: 15,
  },
  liftRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  liftName: {
    fontSize: 15,
    fontWeight: "500",
    flex: 1,
  },
  attempts: {
    flexDirection: "row",
    gap: 24,
    flex: 1,
    justifyContent: "flex-end",
  },
  attempt: {
    fontSize: 16,
    fontWeight: "600",
    minWidth: 50,
    textAlign: "center",
  },
  total: {
    fontSize: 20,
    fontWeight: "600",
    textAlign: "center",
  },
  statusRow: {
    paddingTop: 16,
    alignItems: "center",
  },
  statusText: {
    fontSize: 13,
    textAlign: "center",
  },
  statusRetry: {
    fontWeight: "600",
    marginTop: 4,
  },
  emptyStateContainer: {
    padding: 20,
    alignItems: "center",
  },
  emptyStateText: {
    fontSize: 15,
    textAlign: "center",
  },
  loadingContainer: {
    padding: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  statsGrid: {
    flexDirection: "row",
    padding: 12,
    gap: 12,
  },
  statsColumn: {
    flex: 1,
    paddingHorizontal: 4,
  },
  liftHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  statsValue: {
    fontSize: 20,
    fontWeight: "600",
    minWidth: 70,
    textAlign: "right",
  },
  attemptRatesContainer: {
    gap: 4,
  },
  attemptRateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  attemptRateLabel: {
    fontSize: 13,
    minWidth: 15,
  },
  attemptRateValue: {
    fontSize: 14,
    fontWeight: "500",
    minWidth: 45,
    textAlign: "center",
  },
  attemptRateSubtext: {
    fontSize: 13,
    minWidth: 45,
    textAlign: "right",
  },
  verticalDivider: {
    width: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
});
