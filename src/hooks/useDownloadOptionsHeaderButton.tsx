import { IconSymbol } from "@/components/ui/IconSymbol";
import { useAppColors } from "@/hooks/useAppColors";
import { getSaveIcon } from "@/lib/start-list-utils";
import { useNavigation } from "expo-router";
import React, { useLayoutEffect } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";

const DOWNLOAD_OPTIONS_LABEL = "Open download options";

export function useDownloadOptionsHeaderButton(onPress: () => void): void {
  const navigation = useNavigation();
  const colors = useAppColors();

  useLayoutEffect(() => {
    if (Platform.OS === "ios") {
      navigation.setOptions({
        unstable_headerRightItems: () => [
          {
            type: "button",
            label: DOWNLOAD_OPTIONS_LABEL,
            icon: { type: "sfSymbol", name: "square.and.arrow.down" },
            onPress,
          },
        ],
      });
      return;
    }

    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable
            style={styles.headerIconButton}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={DOWNLOAD_OPTIONS_LABEL}
          >
            <IconSymbol name={getSaveIcon()} size={24} color={colors.text} />
          </Pressable>
        </View>
      ),
    });
  }, [colors.text, navigation, onPress]);
}

const styles = StyleSheet.create({
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  headerIconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
