import React from "react";
import { StyleSheet, View } from "react-native";

/**
 * A scannable row of attempt dots for a lift: filled green = made,
 * filled red = missed, hollow = not taken. Complements (never replaces) the
 * numeric weights coaches rely on.
 */
export function AttemptDots({
  attempts,
  colors,
}: {
  attempts: (number | null)[];
  colors: any;
}) {
  return (
    <View style={styles.row}>
      {attempts.map((attempt, index) => {
        const made = attempt !== null && attempt > 0;
        const missed = attempt !== null && attempt < 0;
        const backgroundColor = made
          ? colors.success
          : missed
            ? colors.fail
            : "transparent";
        const borderColor = made
          ? colors.success
          : missed
            ? colors.fail
            : colors.border;
        return (
          <View
            // Fixed-length, order-stable list: index key is safe here.
            key={index}
            style={[styles.dot, { backgroundColor, borderColor }]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
  },
});
