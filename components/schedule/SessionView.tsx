import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { getPlatformColors } from "@/constants/Colors";
import { PLATFORM_SORT_ORDER } from "@/constants/platform-sort";
import { useAppColors } from "@/hooks/useAppColors";
import { Platform as PlatformType, SessionViewProps } from "@/types/schedule";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { PlatformBadge } from "../schedule-details/PlatformBadge";

export function SessionView({ session, timeZone, meet }: SessionViewProps) {
  const router = useRouter();
  const platformColors = getPlatformColors();
  const colors = useAppColors();

  const sortedPlatforms = useMemo(
    () =>
      [...session.platforms].sort((a, b) => {
        const idxA = PLATFORM_SORT_ORDER.indexOf(
          a.platform as (typeof PLATFORM_SORT_ORDER)[number],
        );
        const idxB = PLATFORM_SORT_ORDER.indexOf(
          b.platform as (typeof PLATFORM_SORT_ORDER)[number],
        );
        return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
      }),
    [session.platforms],
  );

  const handlePlatformPress = (platform: PlatformType) => {
    router.push({
      pathname: "/shared-screens/schedule-details",
      params: {
        id: `${session.id}-${platform.platform}`,
        sessionNumber: session.number,
        platform: platform.platform,
        weightClass: platform.weightClass,
        startTime: session.startTime,
        weighInTime: session.weighInTime,
        meet,
      },
    });
  };

  if (sortedPlatforms.length === 0) return null;

  return (
    <View
      testID={`schedule-session-${session.number}`}
      style={[styles.sessionContainer, { backgroundColor: colors.card }]}
    >
      <ThemedText style={[styles.sessionTitle, { color: colors.text }]}>
        Session{" "}
        {session.number}
      </ThemedText>

      <View
        style={[styles.platformsContainer, { backgroundColor: colors.card }]}
      >
        {sortedPlatforms.map((platform, index) => (
          <PlatformRow
            key={platform.platform}
            session={session}
            platform={platform}
            timeZone={timeZone}
            colors={colors}
            isLast={index === sortedPlatforms.length - 1}
            onPress={() => handlePlatformPress(platform)}
          />
        ))}
      </View>
    </View>
  );
}

type PlatformRowProps = {
  session: SessionViewProps["session"];
  platform: SessionViewProps["session"]["platforms"][number];
  timeZone: string;
  colors: ReturnType<typeof useAppColors>;
  isLast: boolean;
  onPress: () => void;
};

function PlatformRow({
  session,
  platform,
  timeZone,
  colors,
  isLast,
  onPress,
}: PlatformRowProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        testID={`schedule-session-${session.number}-${platform.platform}`}
        accessibilityRole="button"
        accessibilityLabel={`Open session ${session.number} platform ${platform.platform}`}
        style={({ pressed }) => [
          styles.platformCard,
          { backgroundColor: colors.card },
          !isLast && [
            styles.platformCardBorder,
            { borderBottomColor: colors.border },
          ],
          pressed && { backgroundColor: colors.pressed },
        ]}
        onPressIn={() => {
          scale.value = withSpring(0.97, { damping: 15, stiffness: 300 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 15, stiffness: 300 });
        }}
        onPress={onPress}
      >
        <View style={styles.platformContent}>
          <PlatformBadge platform={platform.platform} />
          <View style={styles.platformInfo}>
            <ThemedText
              style={[styles.weightClassText, { color: colors.secondaryText }]}
            >
              {platform.weightClass}
            </ThemedText>
            <ThemedText
              style={[styles.platformTimeText, { color: colors.secondaryText }]}
            >
              Start:{" "}
              {platform.platformStartTime || session.startTime}
              {" "}
              {timeZone}
            </ThemedText>
          </View>
        </View>
        <IconSymbol
          name="chevron.right"
          size={20}
          color={colors.secondaryText}
        />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
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
  sessionTitle: {
    fontSize: 17,
    fontWeight: "600",
    padding: 16,
    paddingBottom: 4,
  },
  platformsContainer: {
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    overflow: "hidden",
    margin: 16,
    marginTop: 0,
  },
  platformCard: {
    padding: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  platformCardBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E1E1E1",
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
  platformTimeText: {
    fontSize: 13,
    marginTop: 2,
  },
  weightClassText: {
    fontSize: 15,
  },
});
