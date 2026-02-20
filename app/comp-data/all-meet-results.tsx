import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { useAppColors } from "@/hooks/useAppColors";
import { searchAthletesByName } from "@/lib/database/queries";
import {
  isNetworkAvailable,
  subscribeToNetworkChanges,
} from "@/lib/networkUtils";
import { posthog } from "@/lib/posthog";
import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
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

export default function AllMeetResultsScreen() {
  const colors = useAppColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [searchText, setSearchText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const searchRequestVersion = useRef(0);

  // Track screen view on mount
  useEffect(() => {
    posthog.capture("screen_viewed", {
      screen_name: "All Meet Results",
    });
  }, []);

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

  // Debounced search effect
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchText.trim().length >= 3) {
        performSearch(searchText.trim());
      } else if (searchText.trim().length === 0) {
        searchRequestVersion.current += 1;
        setSearchResults([]);
        setError(null);
      } else {
        searchRequestVersion.current += 1;
        setIsLoading(false);
      }
    }, 500); // 0.5 seconds debounce

    return () => clearTimeout(timer);
  }, [searchText]);

  const performSearch = async (query: string) => {
    const requestVersion = ++searchRequestVersion.current;
    setIsLoading(true);
    setError(null);
    const hasNetwork = await isNetworkAvailable();
    if (!hasNetwork) {
      if (requestVersion !== searchRequestVersion.current) return;
      setError(null);
      setSearchResults([]);
      setIsOffline(true);
      setIsLoading(false);
      return;
    }

    try {
      const results = await searchAthletesByName(query);
      if (requestVersion !== searchRequestVersion.current) return;
      setSearchResults(results);

      // Track the search
      posthog.capture("athlete_history_searched", {
        query: query,
        results_count: results.length,
      });
    } catch (err) {
      if (requestVersion !== searchRequestVersion.current) return;
      console.error("Error searching athletes:", err);
      setError("Failed to search athletes");
      setSearchResults([]);
    } finally {
      if (requestVersion !== searchRequestVersion.current) return;
      setIsLoading(false);
    }
  };

  const handleAthletePress = useCallback(
    (athleteName: string) => {
      // Track athlete selection
      posthog.capture("athlete_history_viewed", {
        athlete_name: athleteName,
      });

      router.push({
        pathname: "/shared-screens/athlete-results",
        params: { name: athleteName },
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
            Searching...
          </ThemedText>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.centerContainer}>
          <ThemedText style={[styles.emptyTitle, { color: colors.text }]}>
            Error loading athletes
          </ThemedText>
          <ThemedText
            style={[styles.emptyText, { color: colors.secondaryText }]}
          >
            Try searching again
          </ThemedText>
        </View>
      );
    }

    if (isOffline) {
      return (
        <View style={styles.centerContainer}>
          <ThemedText style={[styles.emptyTitle, { color: colors.text }]}>
            Offline
          </ThemedText>
          <ThemedText
            style={[styles.emptyText, { color: colors.secondaryText }]}
          >
            Meet results search is not available without an internet connection
          </ThemedText>
        </View>
      );
    }

    if (searchText.trim().length === 0) {
      return (
        <View style={styles.centerContainer}>
          <IconSymbol
            name={Platform.OS === "ios" ? "magnifyingglass" : "search"}
            size={48}
            color={colors.secondaryText}
          />
          <ThemedText
            style={[styles.emptyTitle, { color: colors.text, marginTop: 16 }]}
          >
            Search for an athlete
          </ThemedText>
          <ThemedText
            style={[styles.emptyText, { color: colors.secondaryText }]}
          >
            Enter a name to view their meet history
          </ThemedText>
        </View>
      );
    }

    if (searchText.trim().length > 0 && searchText.trim().length < 3) {
      return (
        <View style={styles.centerContainer}>
          <IconSymbol
            name={Platform.OS === "ios" ? "magnifyingglass" : "search"}
            size={48}
            color={colors.secondaryText}
          />
          <ThemedText
            style={[
              styles.emptyText,
              { color: colors.secondaryText, marginTop: 16 },
            ]}
          >
            Type at least 3 characters to search
          </ThemedText>
        </View>
      );
    }

    if (searchResults.length === 0) {
      return (
        <View style={styles.centerContainer}>
          <ThemedText
            style={[styles.emptyText, { color: colors.secondaryText }]}
          >
            No athletes found
          </ThemedText>
        </View>
      );
    }

    return null;
  };

  const renderAthleteItem = ({ item }: { item: string }) => (
    <Pressable
      style={({ pressed }) => [
        styles.athleteItem,
        {
          backgroundColor: colors.card,
          borderBottomColor: colors.border,
        },
        pressed && { backgroundColor: colors.pressed },
      ]}
      onPress={() => handleAthletePress(item)}
    >
      <ThemedText style={[styles.athleteName, { color: colors.text }]}>
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
          title: "Meet Results",
          headerBackTitle: "Back",
          headerShown: true,
          gestureEnabled: true,
          gestureDirection: "horizontal",
          animation: "slide_from_right",
          headerTitleStyle: {
            color: colors.text,
          },
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
        }}
      />

      {/* Search Bar */}
      <View
        style={[
          styles.searchContainer,
          {
            backgroundColor: colors.background,
            paddingTop: Platform.OS === "android" ? 12 : 12,
          },
        ]}
      >
        <View
          style={[
            styles.searchInputContainer,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <IconSymbol
            name={Platform.OS === "ios" ? "magnifyingglass" : "search"}
            size={20}
            color={colors.secondaryText}
          />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search for an athlete"
            placeholderTextColor={colors.placeholder}
            value={searchText}
            onChangeText={setSearchText}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="search"
          />
          {searchText.length > 0 && (
            <Pressable
              onPress={() => setSearchText("")}
              style={styles.clearButton}
            >
              <IconSymbol
                name={
                  Platform.OS === "ios" ? "xmark.circle.fill" : "close-circle"
                }
                size={20}
                color={colors.secondaryText}
              />
            </Pressable>
          )}
        </View>
      </View>

      {searchResults.length > 0 ? (
        <FlatList
          data={searchResults}
          renderItem={renderAthleteItem}
          keyExtractor={(item) => item}
          contentContainerStyle={{
            paddingBottom: Math.max(80, insets.bottom + 60),
          }}
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
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  searchInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 44,
  },
  searchInput: {
    flex: 1,
    fontSize: 17,
    paddingVertical: 0,
  },
  clearButton: {
    padding: 4,
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
  athleteItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  athleteName: {
    fontSize: 17,
    flex: 1,
  },
});
