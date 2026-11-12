import { ThemedText } from "@/components/ui/ThemedText";
import { useAppColors } from "@/hooks/useAppColors";
import React from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function CenteredHeaderDate({ children }: { children: string }) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  return (
    <View style={[styles.headerDate, { width: width - insets.left - insets.right }]}>
      <ThemedText style={[styles.headerDateText, { color: colors.text }]}>
        {children}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  headerDate: {
    alignItems: "center",
  },
  headerDateText: {
    fontSize: 17,
    fontWeight: "600",
  },
});
