import { EmptyState } from "@/components/ui/EmptyState";
import { IconSymbol } from "@/components/ui/IconSymbol";
import type { AppColors } from "@/hooks/useAppColors";
import type { loadFailureCopy } from "@/lib/load-failure";
import React from "react";
import { StyleSheet } from "react-native";

export function StartListEmptyState({
  loadFailureText,
  isOfflineFailure,
  isFiltering,
  onRetry,
  onClearFilters,
  colors,
}: {
  loadFailureText: ReturnType<typeof loadFailureCopy> | null;
  isOfflineFailure: boolean;
  isFiltering: boolean;
  onRetry: () => void;
  onClearFilters: () => void;
  colors: AppColors;
}) {
  if (loadFailureText) {
    return (
      <EmptyState
        style={styles.listEmpty}
        icon={
          <IconSymbol
            name={isOfflineFailure ? "wifi.slash" : "arrow.clockwise"}
            size={44}
            color={colors.secondaryText}
          />
        }
        title={loadFailureText.title}
        message={loadFailureText.message}
        actionLabel="Retry"
        onActionPress={onRetry}
      />
    );
  }
  return (
    <EmptyState
      style={styles.listEmpty}
      icon={
        <IconSymbol
          name={isFiltering ? "magnifyingglass" : "list.bullet"}
          size={44}
          color={colors.secondaryText}
        />
      }
      title={isFiltering ? "No athletes match your filters" : "No athletes yet"}
      message={
        isFiltering
          ? "Try adjusting or clearing your filters to see more athletes."
          : "Athletes will appear here once the start list is published."
      }
      actionLabel={isFiltering ? "Clear filters" : undefined}
      onActionPress={isFiltering ? onClearFilters : undefined}
    />
  );
}

const styles = StyleSheet.create({
  listEmpty: {
    paddingTop: 64,
  },
});
