import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { IconSymbol } from "../ui/IconSymbol";
import { ThemedText } from "../ui/ThemedText";

function DownloadRow({
  title,
  subtitle,
  isDownloaded,
  isDownloading,
  onDownload,
  onDelete,
  colors,
  disabled = false,
}: {
  title: string;
  subtitle: string;
  isDownloaded: boolean;
  isDownloading: boolean;
  onDownload: () => void;
  onDelete: () => void;
  /** Refresh All / Delete All is running; the row's own action waits. */
  disabled?: boolean;
  colors: {
    card: string;
    border: string;
    text: string;
    secondaryText: string;
    pressed: string;
    link: string;
    danger: string;
  };
}) {
  const iconName = isDownloaded ? "trash" : "arrow.down.circle";
  const iconColor = isDownloaded ? colors.danger : colors.link;

  return (
    <Pressable
      onPress={isDownloaded ? onDelete : onDownload}
      disabled={disabled}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: colors.border },
        pressed && { backgroundColor: colors.pressed },
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.rowText}>
        <ThemedText style={[styles.rowTitle, { color: colors.text }]}>
          {title}
        </ThemedText>
        <ThemedText
          style={[styles.rowSubtitle, { color: colors.secondaryText }]}
        >
          {subtitle}
        </ThemedText>
      </View>
      <View style={styles.rowAction}>
        {isDownloading ? (
          <ActivityIndicator size="small" color={colors.link} />
        ) : (
          <IconSymbol name={iconName} size={18} color={iconColor} />
        )}
      </View>
    </Pressable>
  );
}

export default DownloadRow;

const styles = StyleSheet.create({
  disabled: {
    opacity: 0.5,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: {
    flex: 1,
    paddingRight: 12,
    gap: 4,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  rowSubtitle: {
    fontSize: 13,
  },
  rowAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
});
