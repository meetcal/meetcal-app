import { ThemedText } from "@/components/ui/ThemedText";
import { useAppColors } from "@/hooks/useAppColors";
import { DayViewProps } from "@/types/schedule";
import { useCallback } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { SessionView } from "./SessionView";

export function DayView({
  day,
  timeZone,
  meet,
  onRefreshComplete,
  refreshing,
}: DayViewProps) {
  const colors = useAppColors();

  const onRefresh = useCallback(async () => {
    try {
      await onRefreshComplete?.();
    } catch (error) {
      console.error("Refresh failed:", error);
      throw error;
    }
  }, [onRefreshComplete]);

  const renderSession = useCallback(
    ({ item }: { item: (typeof day.sessions)[number] }) => (
      <SessionView session={item} timeZone={timeZone} meet={meet} />
    ),
    [timeZone, meet],
  );

  return (
    <FlatList
      data={day.sessions}
      keyExtractor={(item) => item.id}
      renderItem={renderSession}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.text}
        />
      }
      ListEmptyComponent={() => (
        <View style={styles.emptyContainer}>
          <ThemedText style={[styles.emptyText, { color: colors.secondaryText }]}>No sessions found</ThemedText>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: 16,
    paddingBottom: 120,
  },
  emptyContainer: {
    padding: 16,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 16,
    textAlign: "center",
  },
});
