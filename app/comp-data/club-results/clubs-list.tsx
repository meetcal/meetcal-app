import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { useAppColors } from "@/hooks/useAppColors";
import { fetchAllClubs } from "@/lib/database/fetch-club-stats";
import { posthog } from "@/lib/posthog";
import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
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

export default function ShareResultsByClubScreen() {
  const colors = useAppColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [searchText, setSearchText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [allClubs, setAllClubs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Track screen view on mount
  useEffect(() => {
    posthog.capture("screen_viewed", {
      screen_name: "Share Results By Club",
    });
  }, []);

  // Load all clubs on mount
  useEffect(() => {
    loadClubs();
  }, []);

  const loadClubs = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const clubs = await fetchAllClubs();
      setAllClubs(clubs);
      // Trigger one background refresh pass when cached data was returned.
      fetchAllClubs()
        .then((refreshed) => setAllClubs(refreshed))
        .catch(() => {});
    } catch (err) {
      console.error("Error loading clubs:", err);
      setError("Failed to load clubs");
    } finally {
      setIsLoading(false);
    }
  };

  // Filter clubs based on search text
  const filteredClubs =
    searchText.trim().length === 0
      ? allClubs
      : allClubs.filter((club) =>
          club.toLowerCase().includes(searchText.toLowerCase()),
        );

  const handleClubPress = useCallback(
    (club: string) => {
      // Track club selection
      posthog.capture("club_selected_for_results", {
        club_name: club,
      });

      router.push({
        pathname: "/comp-data/club-results/meets-list",
        params: { club },
      });
    },
    [router],
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
            Loading clubs...
          </ThemedText>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.centerContainer}>
          <ThemedText style={[styles.emptyTitle, { color: colors.text }]}>
            Error loading clubs
          </ThemedText>
          <ThemedText
            style={[styles.emptyText, { color: colors.secondaryText }]}
          >
            {error}
          </ThemedText>
          <Pressable
            style={[styles.retryButton, { backgroundColor: colors.link }]}
            onPress={loadClubs}
          >
            <ThemedText style={styles.retryButtonText}>Retry</ThemedText>
          </Pressable>
        </View>
      );
    }

    if (filteredClubs.length === 0 && searchText.trim().length > 0) {
      return (
        <View style={styles.centerContainer}>
          <ThemedText
            style={[styles.emptyText, { color: colors.secondaryText }]}
          >
            No clubs found matching
            {searchText}
          </ThemedText>
        </View>
      );
    }

    if (allClubs.length === 0) {
      return (
        <View style={styles.centerContainer}>
          <ThemedText
            style={[styles.emptyText, { color: colors.secondaryText }]}
          >
            No clubs available
          </ThemedText>
        </View>
      );
    }

    return null;
  };

  const renderClubItem = ({ item }: { item: string }) => (
    <Pressable
      style={({ pressed }) => [
        styles.clubItem,
        {
          backgroundColor: colors.card,
          borderBottomColor: colors.border,
        },
        pressed && { backgroundColor: colors.pressed },
      ]}
      onPress={() => handleClubPress(item)}
    >
      <ThemedText style={[styles.clubName, { color: colors.text }]}>
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
          styles.filterContainer,
          {
            backgroundColor: colors.background,
            borderBottomColor: colors.borderBottom,
            borderBottomWidth: 1,
            paddingTop: insets.top + 16,
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
                styles.searchBar,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <IconSymbol
                name={
                  Platform.select({
                    ios: "magnifyingglass",
                    android: "search",
                  }) || "magnifyingglass"
                }
                size={16}
                color={colors.secondaryText}
              />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Search clubs..."
                placeholderTextColor={colors.secondaryText}
                value={searchText}
                onChangeText={setSearchText}
              />
              {searchText.length > 0 && (
                <Pressable
                  onPress={() => setSearchText("")}
                  style={({ pressed }) => [
                    styles.clearButton,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <IconSymbol
                    name={
                      Platform.select({
                        ios: "xmark.circle.fill",
                        android: "close",
                      }) || "xmark.circle.fill"
                    }
                    size={16}
                    color={colors.secondaryText}
                  />
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </View>

      {filteredClubs.length > 0 ? (
        <FlatList
          data={filteredClubs}
          renderItem={renderClubItem}
          keyExtractor={(item) => item}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: 80 + insets.bottom },
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
  filterContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
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
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    shadowColor: "#000",
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
  clubItem: {
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
  clubName: {
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
