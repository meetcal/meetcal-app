import { useAppColors } from "@/hooks/useAppColors";
import React from "react";
import { StyleSheet } from "react-native";
import { ThemedText } from "../ui/ThemedText";

const SectionTitle = ({ title }: { title: string }) => {
  const colors = useAppColors();

  return (
    <ThemedText style={[styles.sectionHeader, { color: colors.secondaryText }]}>
      {title}
    </ThemedText>
  );
};

export default SectionTitle;

const styles = StyleSheet.create({
  sectionHeader: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 8,
    marginTop: 8,
  },
});
