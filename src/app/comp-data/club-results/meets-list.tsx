import { IconSymbol } from "@/components/ui/IconSymbol";
import { getChevronIcon } from "@/lib/start-list-utils";
import { useIsOffline } from "@/hooks/useIsOffline";
import { SubscriptionGate } from "@/components/ui/SubscriptionGate";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { useAppColors } from "@/hooks/useAppColors";
import { useMutableResource } from "@/hooks/useMutableResource";
import { formatClubMeetDate, type ClubMeet } from "@/lib/club-meets";
import { clubMeetsResource } from "@/lib/database/fetch-club-stats";
import { posthog } from "@/lib/posthog";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";
import { Palette } from "@/constants/Palette";

export default function ClubMeetsListScreen() {
  return (
    <SubscriptionGate>
      <ClubMeetsListScreenContent />
    </SubscriptionGate>
  );
}

function ClubMeetsListScreenContent() {
  const screenInsets = useScreenHorizontalInsets();
  const colors = useAppColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { club } = useLocalSearchParams<{ club: string }>();

  const [searchQuery, setSearchQuery] = useState("");
  const [isOffline] = useIsOffline();
  const params = useMemo<[string] | null>(() => (club ? [club] : null), [club]);
  // The club's meets, newest first.
  const {
    data: allMeets,
    isInitialLoading: isLoading,
    error,
    refresh,
  } = useMutableResource({
    resource: clubMeetsResource,
    params,
    initialData: [] as ClubMeet[],
  });

  // Track screen view on mount
  useEffect(() => {
    posthog.capture("screen_viewed", {
      screen_name: "Club Meets List",
      club_name: club,
    });
  }, [club]);

  const loadMeets = useCallback(async () => {
    await refresh();
  }, [refresh]);

  // Filter meets based on search query
  const meetQuery = searchQuery.trim();
  const uniqueMeets = meetQuery
    ? allMeets.filter(({ meet }) =>
        meet.toLowerCase().includes(meetQuery.toLowerCase()),
      )
    : allMeets;

  const handleMeetPress = useCallback(
    (meet: string) => {
      // Track meet selection
      posthog.capture("club_meet_selected", {
        club_name: club,
        meet_name: meet,
      });

      router.push({
        pathname: "/comp-data/club-results/results",
        params: { club, meet },
      });
    },
    [router, club],
  );

  const renderEmptyState = () => {
    if (isLoading) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.link} />
          <ThemedText
            style={[
              styles.emptyText,
              { color: colors.secondaryText, marginTop: 16 },
            ]}
          >
            Loading meets...
          </ThemedText>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.centerContainer}>
          <ThemedText style={[styles.emptyTitle, { color: colors.text }]}>
            {isOffline ? "Offline" : "Error loading meets"}
          </ThemedText>
          <ThemedText
            style={[styles.emptyText, { color: colors.secondaryText }]}
          >
            {isOffline
              ? "Meet results are not available without an internet connection"
              : error}
          </ThemedText>
          {!isOffline && (
            <Pressable
              style={[styles.retryButton, { backgroundColor: colors.link }]}
              onPress={loadMeets}
              accessibilityRole="button"
            >
              <ThemedText style={styles.retryButtonText}>Retry</ThemedText>
            </Pressable>
          )}
        </View>
      );
    }

    // The search box is what emptied the list: say so, instead of the
    // "no meets for this club" state.
    if (uniqueMeets.length === 0 && allMeets.length > 0) {
      return (
        <View style={styles.centerContainer}>
          <ThemedText style={[styles.emptyTitle, { color: colors.text }]}>
            {`No meets match "${meetQuery}"`}
          </ThemedText>
          <ThemedText
            style={[styles.emptyText, { color: colors.secondaryText }]}
          >
            Try a different search.
          </ThemedText>
        </View>
      );
    }

    if (uniqueMeets.length === 0) {
      return (
        <View style={styles.centerContainer}>
          <ThemedText style={[styles.emptyTitle, { color: colors.text }]}>
            {`No meets found for ${club}`}
          </ThemedText>
        </View>
      );
    }

    return null;
  };

  const renderMeetItem = ({ item }: { item: ClubMeet }) => {
    const date = formatClubMeetDate(item.date);
    return (
    <Pressable
      style={({ pressed }) => [
        styles.meetItem,
        {
          backgroundColor: colors.card,
          borderBottomColor: colors.border,
        },
        pressed && { backgroundColor: colors.pressed },
      ]}
      onPress={() => handleMeetPress(item.meet)}
      accessibilityRole="button"
      accessibilityLabel={date ? `${item.meet}, ${date}` : item.meet}
      accessibilityHint="Shows the club's recap for this meet"
    >
      <View style={styles.meetText}>
        <ThemedText style={[styles.meetName, { color: colors.text }]}>
          {item.meet}
        </ThemedText>
        {date ? (
          <ThemedText style={[styles.meetDate, { color: colors.secondaryText }]}>
            {date}
          </ThemedText>
        ) : null}
      </View>
      <IconSymbol
        name={getChevronIcon("right")}
        size={20}
        color={colors.link}
      />
    </Pressable>
    );
  };

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }, screenInsets]}
    >
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />

      <View
        style={[
          styles.searchWrapper,
          {
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
            paddingTop: insets.top + 12,
          },
        ]}
      >
        <View style={styles.searchRow}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.backButton,
              pressed && { opacity: 0.7 },
            ]}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <IconSymbol
              name={Platform.OS === "ios" ? "chevron.left" : "arrow.back"}
              size={24}
              color={colors.text}
            />
          </Pressable>
          <View style={[styles.searchContainer, { flex: 1 }]}>
            <View
              style={[
                styles.searchInputContainer,
                { backgroundColor: colors.card },
              ]}
            >
              <IconSymbol
                name={Platform.OS === "ios" ? "magnifyingglass" : "search"}
                size={18}
                color={colors.secondaryText}
              />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Search meets..."
                placeholderTextColor={colors.secondaryText}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
              />
              {searchQuery.length > 0 && (
                <Pressable
                  onPress={() => setSearchQuery("")}
                  hitSlop={13}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                >
                  <IconSymbol
                    name={
                      Platform.OS === "ios"
                        ? "xmark.circle.fill"
                        : "close-circle"
                    }
                    size={18}
                    color={colors.secondaryText}
                  />
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </View>

      {uniqueMeets.length > 0 ? (
        <FlatList
          data={uniqueMeets}
          renderItem={renderMeetItem}
          keyExtractor={(item) => item.meet}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={[
            styles.listContent,
            {
              paddingTop: 16,
              paddingBottom: 80 + insets.bottom,
            },
          ]}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        renderEmptyState()
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchWrapper: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    paddingVertical: 8,
    paddingRight: 4,
  },
  searchContainer: {
    marginBottom: 0,
  },
  searchInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
  },
  meetItem: {
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: Palette.shadow,
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
  },
  meetText: {
    flex: 1,
  },
  meetName: {
    fontSize: 17,
  },
  meetDate: {
    fontSize: 13,
    marginTop: 2,
  },
  retryButton: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  retryButtonText: {
    color: Palette.white,
    fontSize: 16,
    fontWeight: "600",
  },
});
