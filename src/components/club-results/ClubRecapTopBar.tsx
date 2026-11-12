import { useRouter } from "expo-router";
import React from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { useAppColors } from "@/hooks/useAppColors";

export function ClubRecapTopBar() {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View
      style={[
        styles.topBar,
        {
          paddingTop: insets.top + 8,
          paddingBottom: 14,
          backgroundColor: colors.background,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <Pressable
        onPress={() => router.back()}
        style={({ pressed }) => [
          styles.backButton,
          pressed && { opacity: 0.6 },
        ]}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <IconSymbol
          name={Platform.OS === "ios" ? "chevron.left" : "arrow.back"}
          size={24}
          color={colors.text}
        />
      </Pressable>
      <View style={styles.topBarCenter}>
        <ThemedText style={[styles.topBarLabel, { color: colors.secondaryText }]}>
          MEET RECAP
        </ThemedText>
      </View>
      <View style={styles.topBarSpacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    paddingVertical: 8,
    paddingRight: 12,
    width: 44,
  },
  topBarCenter: {
    flex: 1,
    alignItems: "center",
  },
  topBarLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2,
  },
  topBarSpacer: {
    width: 44,
  },
});
