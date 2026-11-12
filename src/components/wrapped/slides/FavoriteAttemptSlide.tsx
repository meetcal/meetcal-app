import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { wrappedStyles } from "@/components/wrapped/wrapped-styles";
import { BlackAlpha, Palette, WhiteAlpha } from "@/constants/Palette";
import { attemptIdentity } from "@/lib/wrapped-slide-copy";
import type { WrappedStats } from "@/types/wrapped";

export function FavoriteAttemptSlide({ stats }: { stats: WrappedStats }) {
  const identity = attemptIdentity(stats.favoriteAttempt);

  return (
    <View style={wrappedStyles.slideInner}>
      <Text style={wrappedStyles.slideTopLabel}>YOUR IDENTITY</Text>
      <View style={styles.attemptCenter}>
        <Text style={styles.attemptOrdinal}>{stats.favoriteAttempt}</Text>
        <Text style={styles.attemptLabel}>ATTEMPT</Text>
        <View style={styles.attemptDivider} />
        <Text style={styles.attemptTitle}>
          {identity.title}
        </Text>
        <View style={styles.attemptDescCard}>
          <Text style={styles.attemptDescription}>
            {identity.description}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  attemptCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  attemptOrdinal: {
    fontSize: 96,
    fontWeight: "900",
    color: Palette.white,
    lineHeight: 96,
  },
  attemptLabel: {
    fontSize: 28,
    fontWeight: "800",
    color: WhiteAlpha[70],
    letterSpacing: 8,
    marginBottom: 16,
  },
  attemptDivider: {
    width: 48,
    height: 3,
    backgroundColor: WhiteAlpha[30],
    borderRadius: 2,
    marginVertical: 20,
  },
  attemptTitle: {
    fontSize: 32,
    fontWeight: "900",
    color: Palette.white,
    letterSpacing: 4,
    marginBottom: 24,
  },
  attemptDescCard: {
    backgroundColor: BlackAlpha[25],
    borderRadius: 20,
    paddingHorizontal: 28,
    paddingVertical: 20,
  },
  attemptDescription: {
    fontSize: 16,
    fontWeight: "500",
    color: WhiteAlpha[80],
    textAlign: "center",
    lineHeight: 24,
  },
});
