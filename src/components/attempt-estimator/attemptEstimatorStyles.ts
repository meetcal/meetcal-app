import { Palette } from "@/constants/Palette";
import { StyleSheet } from "react-native";

export const attemptEstimatorStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingTop: 16,
  },
  disclaimerCard: {
    padding: 16,
    borderRadius: 10,
    marginBottom: 16,
    borderWidth: 1,
  },
  disclaimerText: {
    fontSize: 14,
    fontStyle: "italic",
    textAlign: "center",
    lineHeight: 20,
  },
  athleteCard: {
    borderRadius: 10,
    marginBottom: 12,
    overflow: "hidden",
  },
  athleteHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
  },
  athleteHeaderText: {
    flex: 1,
    marginRight: 12,
  },
  athleteName: {
    fontSize: 14,
    fontWeight: "600",
  },
  athleteSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 12,
  },
  statusText: {
    fontSize: 13,
  },
  messageContainer: {
    alignItems: "center",
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  messageTitle: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 8,
    textAlign: "center",
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 16,
  },
  retryButton: {
    minHeight: 44,
    minWidth: 120,
    paddingHorizontal: 24,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  retryButtonText: {
    color: Palette.white,
    fontSize: 16,
    fontWeight: "600",
  },
  athleteDetails: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  section: {
    paddingVertical: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 8,
  },
  detailText: {
    fontSize: 15,
    lineHeight: 20,
    marginTop: 4,
  },
  divider: {
    height: 1,
    marginVertical: 8,
  },
  table: {
    marginTop: 8,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 8,
  },
  tableCell: {
    flex: 1,
    textAlign: "center",
  },
  tableHeader: {
    fontWeight: "600",
    fontSize: 15,
  },
  tableCellText: {
    flex: 1,
    textAlign: "center",
    fontSize: 15,
  },
  tableDivider: {
    height: 1,
    marginVertical: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  skeletonLine: {
    height: 14,
    borderRadius: 7,
  },
  skeletonChevron: {
    width: 16,
    height: 16,
    borderRadius: 4,
  },
});
