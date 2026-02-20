import { useAppColors } from "@/hooks/useAppColors";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { IconSymbol } from "../ui/IconSymbol";
import { ThemedText } from "../ui/ThemedText";

interface ListButtonProps {
  title: string;
  onPress: () => void;
  lastSection?: boolean;
}

const ListButton = ({ title, onPress, lastSection }: ListButtonProps) => {
  const colors = useAppColors();

  return (
    <Pressable
      style={({ pressed }) => [
        styles.section,
        {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        },
        pressed && { backgroundColor: colors.pressed },
        lastSection && styles.lastSection,
      ]}
      onPress={onPress}
    >
      <View style={styles.linkRow}>
        <ThemedText style={[styles.label, { color: colors.text }]}>
          {title}
        </ThemedText>
        <IconSymbol name="chevron.right" size={20} color={colors.link} />
      </View>
    </Pressable>
  );
};

export default ListButton;

const styles = StyleSheet.create({
  section: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: 16,
    marginBottom: 4,
  },
  linkRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  lastSection: {
    borderBottomWidth: 0,
  },
});
