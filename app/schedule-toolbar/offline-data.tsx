import DownloadRow from "@/components/offline/DownloadRow";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { useAppColors } from "@/hooks/useAppColors";
import { prefetchMeetData } from "@/lib/database/meet-manager";
import { clearMeetData } from "@/lib/database/offline-store";
import { useOfflineData } from "@/utils/offline";
import { Stack } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import PaywallScreen from "../shared-screens/paywall";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";

const OFFLINE_DATA_ROUTE = "/schedule-toolbar/offline-data";

export default function OfflineDataScreen() {
  const screenInsets = useScreenHorizontalInsets();
  const colors = useAppColors();
  const {
    isSubscribed,
    isSubscriptionLoading,
    isMeetLoading,
    filteredMeets,
    downloadingItems,
    downloadStatuses,
    isRefreshingAll,
    isDeletingAll,
    competitionItems,
    formatLastSynced,
    handleDownload,
    handleDelete,
    confirmRefreshAll,
    confirmDeleteAll,
  } = useOfflineData();

  if (isSubscriptionLoading || isMeetLoading) {
    return (
      <ThemedView
        style={[
          styles.container,
          {
            backgroundColor: colors.background,
            justifyContent: "center",
            alignItems: "center",
          },
        ]}
      >
        <ActivityIndicator size="large" color={colors.link} />
      </ThemedView>
    );
  }

  // The paywall renders inline, so it cannot read `from` from the route;
  // without it a signed-out user signing in (or closing the paywall) lands
  // on the schedule tab instead of back here.
  if (!isSubscribed) {
    return <PaywallScreen from={OFFLINE_DATA_ROUTE} feature="offline-data" />;
  }

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }, screenInsets]}
    >
      <Stack.Screen
        options={{
          title: "Offline Data",
          headerBackTitle: "Back",
          headerShown: true,
          gestureEnabled: true,
          gestureDirection: "horizontal",
          animation: "slide_from_right",
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
          headerTitleStyle: {
            color: colors.text,
          },
          headerTintColor: colors.text,
          // Native UIBarButtonItems on iOS so they move into iPhone Duo's
          // vertical bar. Native items can't host a spinner, so in-flight state
          // is the standard dimmed/disabled treatment instead.
          ...(Platform.OS === "ios"
            ? {
                unstable_headerRightItems: () => [
                  {
                    type: "button" as const,
                    label: "Refresh all offline data",
                    icon: {
                      type: "sfSymbol" as const,
                      name: "arrow.clockwise" as const,
                    },
                    tintColor: colors.link,
                    disabled: isRefreshingAll || isDeletingAll,
                    onPress: confirmRefreshAll,
                  },
                  {
                    type: "button" as const,
                    label: "Delete all offline data",
                    icon: { type: "sfSymbol" as const, name: "trash" as const },
                    tintColor: colors.danger,
                    disabled: isRefreshingAll || isDeletingAll,
                    onPress: confirmDeleteAll,
                  },
                ],
              }
            : {
                headerRight: () => (
                  <View style={styles.headerActions}>
                    <Pressable
                      onPress={confirmRefreshAll}
                      disabled={isRefreshingAll || isDeletingAll}
                      style={({ pressed }) => [
                        styles.headerButton,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      {isRefreshingAll ? (
                        <ActivityIndicator size="small" color={colors.link} />
                      ) : (
                        <IconSymbol
                          name="arrow.clockwise"
                          size={20}
                          color={colors.link}
                        />
                      )}
                    </Pressable>
                    <Pressable
                      onPress={confirmDeleteAll}
                      disabled={isRefreshingAll || isDeletingAll}
                      style={({ pressed }) => [
                        styles.headerButton,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      {isDeletingAll ? (
                        <ActivityIndicator size="small" color={colors.danger} />
                      ) : (
                        <IconSymbol
                          name="trash"
                          size={20}
                          color={colors.danger}
                        />
                      )}
                    </Pressable>
                  </View>
                ),
              }),
        }}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>
            Schedule & Start List
          </ThemedText>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            {filteredMeets.length === 0 && (
              <View style={styles.emptyRow}>
                <ThemedText
                  style={[styles.emptyText, { color: colors.secondaryText }]}
                >
                  No meets available right now.
                </ThemedText>
              </View>
            )}
            {filteredMeets.map((meet) => {
              const id = `meet:${meet.name}`;
              const status = downloadStatuses[id];
              const isDownloading = downloadingItems.has(id);
              return (
                <DownloadRow
                  key={id}
                  title={meet.name}
                  subtitle={formatLastSynced(status?.lastSynced)}
                  isDownloaded={status?.isDownloaded ?? false}
                  isDownloading={isDownloading}
                  disabled={isRefreshingAll || isDeletingAll}
                  colors={colors}
                  onDownload={() =>
                    handleDownload(id, () => prefetchMeetData(meet.name))
                  }
                  onDelete={() =>
                    handleDelete(meet.name, id, () => clearMeetData(meet.name))
                  }
                />
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>
            Competition Data
          </ThemedText>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            {competitionItems.map((item) => {
              const status = downloadStatuses[item.id];
              const isDownloading = downloadingItems.has(item.id);
              return (
                <DownloadRow
                  key={item.id}
                  title={item.title}
                  subtitle={formatLastSynced(status?.lastSynced)}
                  isDownloaded={status?.isDownloaded ?? false}
                  isDownloading={isDownloading}
                  disabled={isRefreshingAll || isDeletingAll}
                  colors={colors}
                  onDownload={() => handleDownload(item.id, item.onDownload)}
                  onDelete={() =>
                    handleDelete(item.title, item.id, item.onDelete)
                  }
                />
              );
            })}
          </View>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 20,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  card: {
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
  },
  emptyRow: {
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  emptyText: {
    fontSize: 14,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
});
