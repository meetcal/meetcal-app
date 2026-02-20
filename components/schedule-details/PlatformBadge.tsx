import { getPlatformColors } from "@/constants/Colors";
import { Platform as PlatformType } from "@/data/types/athletes";
import { StyleSheet, View } from "react-native";
import { ThemedText } from "../ui/ThemedText";

export function PlatformBadge({ platform }: { platform: PlatformType }) {
  const platformColors = getPlatformColors();
  const backgroundColor = platformColors[platform as PlatformType] || "#808080";

  return (
    <View style={[styles.platformBadge, { backgroundColor }]}>
      <ThemedText style={styles.platformText}>{platform}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  platformBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    width: 80,
    alignItems: "center",
  },
  platformText: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "600",
  },
});
