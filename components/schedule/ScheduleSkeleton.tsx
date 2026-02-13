import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { useAppColors } from "@/hooks/useAppColors";
import { useCallback, useEffect, useRef } from "react";
import { Animated, ScrollView, StyleSheet, View } from "react-native";

interface ScheduleSkeletonProps {
  label?: string;
}

export function ScheduleSkeleton({
  label = "Loading schedule...",
}: ScheduleSkeletonProps) {
  const colors = useAppColors();
  const skeletonPulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(skeletonPulse, {
          toValue: 0.9,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(skeletonPulse, {
          toValue: 0.4,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [skeletonPulse]);

  const SkeletonBlock = useCallback(
    ({ style }: { style: any }) => {
      const backgroundColor = colors.card;
      return (
        <Animated.View
          style={[
            styles.skeletonBlock,
            { backgroundColor, opacity: skeletonPulse },
            style,
          ]}
        />
      );
    },
    [colors, skeletonPulse],
  );

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <View
        style={[
          styles.filterContainer,
          {
            backgroundColor: colors.background,
            borderBottomColor: colors.borderBottom,
            borderBottomWidth: 1,
          },
        ]}
      >
        <View style={styles.filterRow}>
          <View
            style={[
              styles.filterButton,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.filterTextContainer}>
              <SkeletonBlock style={styles.skeletonLineShort} />
              <SkeletonBlock style={styles.skeletonLine} />
            </View>
            <SkeletonBlock style={styles.skeletonIcon} />
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.skeletonContent}>
        {[0, 1, 2].map((index) => (
          <View
            key={`skeleton-${index}`}
            style={[styles.sessionContainer, { backgroundColor: colors.card }]}
          >
            <View style={styles.skeletonSection}>
              <SkeletonBlock style={styles.skeletonTitle} />
              <SkeletonBlock style={styles.skeletonSubtitle} />
            </View>
            <View style={styles.skeletonTimeRow}>
              <SkeletonBlock style={styles.skeletonChip} />
              <SkeletonBlock style={styles.skeletonChip} />
            </View>
            <View
              style={[
                styles.platformsContainer,
                { backgroundColor: colors.card },
              ]}
            >
              {[0, 1, 2].map((row) => (
                <View
                  key={`platform-${index}-${row}`}
                  style={styles.platformCard}
                >
                  <View style={styles.platformContent}>
                    <SkeletonBlock style={styles.skeletonBadge} />
                    <View style={styles.platformInfo}>
                      <SkeletonBlock style={styles.skeletonLine} />
                      <SkeletonBlock style={styles.skeletonLineShort} />
                    </View>
                  </View>
                  <SkeletonBlock style={styles.skeletonTiny} />
                </View>
              ))}
            </View>
          </View>
        ))}
        <ThemedText
          style={[
            styles.loadingText,
            { color: colors.secondaryText, marginTop: 12 },
          ]}
        >
          {label}
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  filterContainer: {
    padding: 16,
  },
  filterRow: {
    width: "100%",
  },
  filterButton: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    elevation: 1,
  },
  filterTextContainer: {
    flex: 1,
    marginRight: 8,
  },
  skeletonContent: {
    padding: 16,
    paddingBottom: 40,
  },
  skeletonBlock: {
    borderRadius: 6,
  },
  sessionContainer: {
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  skeletonSection: {
    padding: 16,
    paddingBottom: 8,
  },
  skeletonTitle: {
    height: 18,
    width: "60%",
    marginBottom: 10,
  },
  skeletonSubtitle: {
    height: 14,
    width: "40%",
  },
  skeletonLine: {
    height: 12,
    width: "75%",
  },
  skeletonLineShort: {
    height: 12,
    width: "45%",
    marginTop: 6,
  },
  skeletonIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  skeletonChip: {
    height: 12,
    width: 80,
    borderRadius: 6,
  },
  skeletonBadge: {
    width: 52,
    height: 22,
    borderRadius: 6,
  },
  skeletonTiny: {
    width: 24,
    height: 12,
    borderRadius: 6,
  },
  skeletonTimeRow: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: "row",
    gap: 12,
  },
  platformsContainer: {
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    overflow: "hidden",
    margin: 16,
    marginTop: 0,
  },
  platformCard: {
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  platformContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginRight: 12,
  },
  platformInfo: {
    flex: 1,
    marginLeft: 8,
  },
  loadingText: {
    fontSize: 16,
    textAlign: "center",
  },
});
