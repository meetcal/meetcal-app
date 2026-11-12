import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { wrappedStyles } from "@/components/wrapped/wrapped-styles";
import { Palette, WhiteAlpha } from "@/constants/Palette";
import type { WrappedStats } from "@/types/wrapped";

export function TitleSlide({ name, year, stats }: { name: string; year: number; stats: WrappedStats }) {
  return (
    <View style={wrappedStyles.slideInner}>
      <Text style={wrappedStyles.slideTopLabel}>WEIGHTLIFTING WRAPPED</Text>
      <View style={styles.titleSlideCenter}>
        <Text style={styles.titleSlideYear}>{year}</Text>
        <View style={styles.titleDivider} />
        <Text style={styles.titleSlideName}>{name.toUpperCase()}</Text>
        <View style={styles.rankBadge}>
          <Text style={styles.rankBadgeText}>{stats.yearRank}</Text>
        </View>
      </View>
      <View style={styles.titleBottomRow}>
        <View style={styles.titleBottomStat}>
          <Text style={styles.titleBottomNumber}>{stats.totalMeets}</Text>
          <Text style={styles.titleBottomLabel}>meets</Text>
        </View>
        <View style={styles.titleBottomDivider} />
        <View style={styles.titleBottomStat}>
          <Text style={styles.titleBottomNumber}>
{stats.makePercentage.toFixed(0)}
%
</Text>
          <Text style={styles.titleBottomLabel}>make rate</Text>
        </View>
        <View style={styles.titleBottomDivider} />
        <View style={styles.titleBottomStat}>
          <Text style={styles.titleBottomNumber}>{stats.bestTotal}</Text>
          <Text style={styles.titleBottomLabel}>best total</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  titleSlideCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  titleSlideYear: {
    fontSize: 96,
    fontWeight: "900",
    color: Palette.white,
    letterSpacing: -2,
    lineHeight: 96,
  },
  titleDivider: {
    width: 60,
    height: 3,
    backgroundColor: WhiteAlpha[40],
    borderRadius: 2,
    marginVertical: 20,
  },
  titleSlideName: {
    fontSize: 22,
    fontWeight: "800",
    color: Palette.white,
    letterSpacing: 4,
    textAlign: "center",
    marginBottom: 20,
  },
  rankBadge: {
    backgroundColor: WhiteAlpha[15],
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: WhiteAlpha[25],
  },
  rankBadgeText: {
    fontSize: 14,
    fontWeight: "700",
    color: Palette.white,
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  titleBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    paddingBottom: 10,
  },
  titleBottomStat: {
    alignItems: "center",
  },
  titleBottomNumber: {
    fontSize: 24,
    fontWeight: "900",
    color: Palette.white,
  },
  titleBottomLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: WhiteAlpha[50],
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: 2,
  },
  titleBottomDivider: {
    width: 1,
    height: 32,
    backgroundColor: WhiteAlpha[20],
  },
});
