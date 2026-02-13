import { useCallback } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { SessionView } from "./SessionView";
import { ThemedText } from "@/components/ThemedText";
import { useAppColors } from "@/hooks/useAppColors";
import { DaySchedule } from "@/types/schedule";

interface DayViewProps {
  day: DaySchedule;
  timeZone: string;
  onRefreshComplete?: () => Promise<void>;
  refreshing: boolean;
}

export function DayView({
  day,
  timeZone,
  onRefreshComplete,
  refreshing,
}: DayViewProps) {
  const colors = useAppColors();

  const onRefresh = useCallback(async () => {
    try {
      await onRefreshComplete?.();
    } catch (error) {
      console.error("Refresh failed:", error);
    }
  }, [onRefreshComplete]);

  return (
    <FlatList
      data={day.sessions}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <SessionView session={item} timeZone={timeZone} />
      )}
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
          <ThemedText style={styles.emptyText}>No sessions found</ThemedText>
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
    color: "#666",
    textAlign: "center",
  },
});
