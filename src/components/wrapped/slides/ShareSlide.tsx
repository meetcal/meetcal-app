import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { wrappedStyles } from "@/components/wrapped/wrapped-styles";
import { Palette, WhiteAlpha } from "@/constants/Palette";
import type { WrappedStats } from "@/types/wrapped";

export function ShareSlide({
  stats,
  name,
  year,
}: {
  stats: WrappedStats;
  name: string;
  year: number;
}) {
  return (
    <View style={wrappedStyles.slideInner}>
      <Text style={wrappedStyles.slideTopLabel}>THAT&apos;S A WRAP</Text>
      <View style={styles.shareCenter}>
        <Text style={styles.shareYear}>{year}</Text>
        <Text style={styles.shareName}>{name.toUpperCase()}</Text>

        <View style={styles.shareSummaryGrid}>
          <View style={styles.shareSummaryItem}>
            <Text style={styles.shareSummaryValue}>
{stats.bestSnatch}
kg
</Text>
            <Text style={styles.shareSummaryLabel}>SNATCH</Text>
          </View>
          <View style={styles.shareSummaryItem}>
            <Text style={styles.shareSummaryValue}>
{stats.bestCleanJerk}
kg
</Text>
            <Text style={styles.shareSummaryLabel}>C&J</Text>
          </View>
          <View style={styles.shareSummaryItem}>
            <Text style={styles.shareSummaryValue}>
{stats.bestTotal}
kg
</Text>
            <Text style={styles.shareSummaryLabel}>TOTAL</Text>
          </View>
          <View style={styles.shareSummaryItem}>
            <Text style={styles.shareSummaryValue}>
{stats.makePercentage.toFixed(0)}
%
</Text>
            <Text style={styles.shareSummaryLabel}>MAKES</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shareCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
  },
  shareYear: {
    fontSize: 56,
    fontWeight: "900",
    color: Palette.white,
    lineHeight: 56,
  },
  shareName: {
    fontSize: 18,
    fontWeight: "800",
    color: WhiteAlpha[70],
    letterSpacing: 4,
    marginTop: 8,
    marginBottom: 32,
    textAlign: "center",
  },
  shareSummaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    width: "100%",
    marginBottom: 36,
  },
  shareSummaryItem: {
    flex: 1,
    minWidth: "40%",
    backgroundColor: WhiteAlpha[10],
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: WhiteAlpha[8],
  },
  shareSummaryValue: {
    fontSize: 28,
    fontWeight: "900",
    color: Palette.white,
    marginBottom: 4,
  },
  shareSummaryLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: WhiteAlpha[50],
    letterSpacing: 2,
  },
});
