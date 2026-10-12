import React from "react";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";

import { IconSymbol } from "@/components/ui/IconSymbol";
import { Palette } from "@/constants/Palette";
import type { AppColors } from "@/hooks/useAppColors";

/** The Start List's athlete search box, with a clear button once it has text. */
export function StartListSearchBar({
  value,
  onChangeText,
  colors,
}: {
  value: string;
  onChangeText: (text: string) => void;
  colors: AppColors;
}) {
  return (
    <View style={styles.searchContainer}>
      <View
        style={[
          styles.searchBar,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <IconSymbol
          name={
            Platform.select({ ios: "magnifyingglass", android: "search" }) ||
            "magnifyingglass"
          }
          size={16}
          color={colors.secondaryText}
        />
        <TextInput
          testID="start-list-search"
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search athletes..."
          placeholderTextColor={colors.secondaryText}
          value={value}
          onChangeText={onChangeText}
          autoCorrect={false}
          spellCheck={false}
        />
        {value.length > 0 && (
          <Pressable
            onPress={() => onChangeText("")}
            style={({ pressed }) => [styles.clearButton, pressed && { opacity: 0.7 }]}
          >
            <IconSymbol
              name={
                Platform.select({ ios: "xmark.circle.fill", android: "close" }) ||
                "xmark.circle.fill"
              }
              size={16}
              color={colors.secondaryText}
            />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  searchContainer: {
    marginBottom: 2,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    shadowColor: Palette.shadow,
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    elevation: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    padding: 0,
    height: 24,
    marginRight: 8,
  },
  clearButton: {
    padding: 4,
    marginRight: -4,
  },
});
