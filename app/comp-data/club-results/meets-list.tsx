import { IconSymbol } from "@/components/ui/IconSymbol";
import { SubscriptionGate } from "@/components/ui/SubscriptionGate";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { useAppColors } from "@/hooks/useAppColors";
import { useMutableResource } from "@/hooks/useMutableResource";
import { clubAthletesResource } from "@/lib/database/fetch-club-stats";
import {
  isNetworkAvailable,
  subscribeToNetworkChanges,
} from "@/lib/networkUtils";
import { posthog } from "@/lib/posthog";
import type { AthleteClub } from "@/types/club";
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

export default function ClubMeetsListScreen() {
  return (
    <SubscriptionGate>
      <ClubMeetsListScreenContent />
    </SubscriptionGate>
  );
}

function ClubMeetsListScreenContent() {
  const colors = useAppColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { club } = useLocalSearchParams<{ club: string }>();

  const [searchQuery, setSearchQuery] = useState("");
  const [isOffline, setIsOffline] = useState(false);
  const params = useMemo(() => (club ? ([club] as const) : null), [club]);
  const {
    data: athletesInClub,
    isInitialLoading: isLoading,
    error,
    refresh,
  } = useMutableResource({
    resource: clubAthletesResource,
    params: (params ?? ([""] as const)) as [string],
    initialData: [] as AthleteClub[],
    enabled: Boolean(params),
  });

  // Track screen view on mount
  useEffect(() => {
    posthog.capture("screen_viewed", {
      screen_name: "Club Meets List",
      club_name: club,
    });
  }, [club]);

  useEffect(() => {
    let isMounted = true;
    const checkNetwork = async () => {
      const hasNetwork = await isNetworkAvailable();
      if (isMounted) setIsOffline(!hasNetwork);
    };
    checkNetwork();
    const unsubscribe = subscribeToNetworkChanges((isConnected) => {
      setIsOffline(!isConnected);
    });
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const loadAthletes = useCallback(async () => {
    await refresh();
  }, [refresh]);

  // Get unique meets from athletes
  const allMeets = Array.from(
    new Set(athletesInClub.map((a) => a.meet)),
  ).sort();

  // Filter meets based on search query
  const uniqueMeets = searchQuery
    ? allMeets.filter((meet) =>
        meet.toLowerCase().includes(searchQuery.toLowerCase()),
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
              onPress={loadAthletes}
            >
              <ThemedText style={styles.retryButtonText}>Retry</ThemedText>
            </Pressable>
          )}
        </View>
      );
    }

    if (uniqueMeets.length === 0) {
      return (
        <View style={styles.centerContainer}>
          <ThemedText style={[styles.emptyTitle, { color: colors.text }]}>
            {`No meets found for ${club}`}
          </ThemedText>
          <ThemedText
            style={[styles.emptyText, { color: colors.secondaryText }]}
          >
            {`Athletes: ${athletesInClub.length}`}
          </ThemedText>
        </View>
      );
    }

    return null;
  };

  const renderMeetItem = ({ item }: { item: string }) => (
    <Pressable
      style={({ pressed }) => [
        styles.meetItem,
        {
          backgroundColor: colors.card,
          borderBottomColor: colors.border,
        },
        pressed && { backgroundColor: colors.pressed },
      ]}
      onPress={() => handleMeetPress(item)}
    >
      <ThemedText style={[styles.meetName, { color: colors.text }]}>
        {item}
      </ThemedText>
      <IconSymbol
        name={Platform.OS === "ios" ? "chevron.right" : "chevron-forward"}
        size={20}
        color={colors.link}
      />
    </Pressable>
  );

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }]}
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
                <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
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
          keyExtractor={(item) => item}
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
    shadowColor: "#000",
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
  meetName: {
    fontSize: 17,
    flex: 1,
  },
  retryButton: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
});
