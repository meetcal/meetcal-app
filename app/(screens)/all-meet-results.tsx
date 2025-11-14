import { StyleSheet, View, ActivityIndicator, FlatList, Pressable, Platform, TextInput } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { useTheme } from '@/contexts/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useState, useEffect, useCallback } from 'react';
import { searchAthletesByName } from '@/lib/database/queries';
import { posthog } from '@/lib/posthog';

export default function AllMeetResultsScreen() {
  const { currentTheme } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [searchText, setSearchText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Track screen view on mount
  useEffect(() => {
    posthog.capture('screen_viewed', {
      screen_name: 'All Meet Results'
    });
  }, []);

  // Define theme colors
  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
    link: '#007AFF',
    searchBackground: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    searchBorder: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    placeholder: currentTheme === 'dark' ? '#8E8E93' : '#999999',
  };

  // Debounced search effect
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchText.trim().length >= 3) {
        performSearch(searchText.trim());
      } else if (searchText.trim().length === 0) {
        setSearchResults([]);
        setError(null);
      }
    }, 500); // 0.5 seconds debounce

    return () => clearTimeout(timer);
  }, [searchText]);

  const performSearch = async (query: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const results = await searchAthletesByName(query);
      setSearchResults(results);

      // Track the search
      posthog.capture('athlete_history_searched', {
        query: query,
        results_count: results.length
      });
    } catch (err) {
      console.error('Error searching athletes:', err);
      setError('Failed to search athletes');
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAthletePress = useCallback((athleteName: string) => {
    // Track athlete selection
    posthog.capture('athlete_history_viewed', {
      athlete_name: athleteName
    });

    router.push({
      pathname: '/(screens)/athlete-results',
      params: { name: athleteName }
    });
  }, [router]);

  const renderEmptyState = () => {
    if (isLoading) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.link} />
          <ThemedText style={[styles.emptyText, { color: colors.secondaryText, marginTop: 16 }]}>
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
          <ThemedText style={[styles.emptyText, { color: colors.secondaryText }]}>
            Try searching again
          </ThemedText>
        </View>
      );
    }

    if (searchText.trim().length === 0) {
      return (
        <View style={styles.centerContainer}>
          <IconSymbol
            name={Platform.OS === 'ios' ? 'magnifyingglass' : 'search'}
            size={48}
            color={colors.secondaryText}
          />
          <ThemedText style={[styles.emptyTitle, { color: colors.text, marginTop: 16 }]}>
            Search for an athlete
          </ThemedText>
          <ThemedText style={[styles.emptyText, { color: colors.secondaryText }]}>
            Enter a name to view their meet history
          </ThemedText>
        </View>
      );
    }

    if (searchText.trim().length > 0 && searchText.trim().length < 3) {
      return (
        <View style={styles.centerContainer}>
          <IconSymbol
            name={Platform.OS === 'ios' ? 'magnifyingglass' : 'search'}
            size={48}
            color={colors.secondaryText}
          />
          <ThemedText style={[styles.emptyText, { color: colors.secondaryText, marginTop: 16 }]}>
            Type at least 3 characters to search
          </ThemedText>
        </View>
      );
    }

    if (searchResults.length === 0) {
      return (
        <View style={styles.centerContainer}>
          <ThemedText style={[styles.emptyText, { color: colors.secondaryText }]}>
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
        pressed && { backgroundColor: colors.pressed }
      ]}
      onPress={() => handleAthletePress(item)}
    >
      <ThemedText style={[styles.athleteName, { color: colors.text }]}>
        {item}
      </ThemedText>
      <IconSymbol
        name={Platform.OS === 'ios' ? 'chevron.right' : 'chevron-forward'}
        size={20}
        color={colors.link}
      />
    </Pressable>
  );

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: 'Meet Results',
          headerBackTitle: 'Back',
          headerShown: true,
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          animation: 'slide_from_right',
          headerTitleStyle: {
            color: colors.text,
          },
          headerStyle: {
            backgroundColor: currentTheme === 'dark' ? '#000000' : '#FFFFFF',
          },
          headerShadowVisible: false,
        }}
      />

      {/* Search Bar */}
      <View style={[styles.searchContainer, {
        backgroundColor: colors.background,
        paddingTop: Platform.OS === 'android' ? 12 : 12
      }]}>
        <View style={[styles.searchInputContainer, {
          backgroundColor: colors.searchBackground,
          borderColor: colors.searchBorder
        }]}>
          <IconSymbol
            name={Platform.OS === 'ios' ? 'magnifyingglass' : 'search'}
            size={20}
            color={colors.secondaryText}
            style={styles.searchIcon}
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
            <Pressable onPress={() => setSearchText('')} style={styles.clearButton}>
              <IconSymbol
                name={Platform.OS === 'ios' ? 'xmark.circle.fill' : 'close-circle'}
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
            paddingBottom: Math.max(80, insets.bottom + 60)
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
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 44,
  },
  searchIcon: {
    marginRight: 8,
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
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  athleteItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  athleteName: {
    fontSize: 17,
    flex: 1,
  },
});
