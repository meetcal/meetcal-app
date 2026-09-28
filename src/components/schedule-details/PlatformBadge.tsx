import { platformColor } from "@/constants/Colors";
import { Platform as PlatformType } from "@/data/types/athletes";
import { StyleSheet, View } from "react-native";
import { ThemedText } from "../ui/ThemedText";
import { Palette } from "@/constants/Palette";

export function PlatformBadge({ platform }: { platform: PlatformType }) {
  const backgroundColor = platformColor(platform);

  return (
    <View
      testID="platform-badge"
      style={[styles.platformBadge, { backgroundColor }]}
    >
      <ThemedText style={styles.platformText}>{platform}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  platformBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    minWidth: 80,
    alignItems: "center",
  },
  platformText: {
    color: Palette.white,
    fontSize: 15,
    fontWeight: "600",
  },
});
