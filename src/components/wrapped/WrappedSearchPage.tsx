import { LinearGradient } from "expo-linear-gradient";
import { Stack, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeIn, FadeInDown, FadeInUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { wrappedStyles } from "@/components/wrapped/wrapped-styles";
import { BlackAlpha, Palette, WhiteAlpha, WrappedGradients, WrappedPalette } from "@/constants/Palette";
import type { WrappedSearch } from "@/hooks/useWrappedSearch";

const SELECTABLE_YEAR_COUNT = 10;
const YEARS = Array.from(
  { length: SELECTABLE_YEAR_COUNT },
  (_, i) => new Date().getFullYear() - i,
);

const SEARCH_PAGE_SIDE_PADDING = 28;

export function WrappedSearchPage({ search }: { search: WrappedSearch }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    searchQuery,
    onSearchTextChange,
    selectedYear,
    setSelectedYear,
    loading,
    isOffline,
    suggestions,
    showSuggestions,
    loadingSuggestions,
    didYouMean,
    selectSuggestion,
    searchAthlete,
  } = search;

  return (
    <View style={wrappedStyles.storyContainer}>
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />
      <LinearGradient
        colors={WrappedGradients.searchBackground}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      <Pressable
        style={[styles.backNavButton, { top: insets.top + 8, left: insets.left + 16 }]}
        onPress={() => router.back()}
        hitSlop={16}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <View style={styles.backNavButtonBg}>
          <IconSymbol name="chevron.left" size={20} color={Palette.white} />
        </View>
      </Pressable>

      <ScrollView
        style={styles.searchScroll}
        contentContainerStyle={[
          styles.searchScrollContent,
          {
            paddingTop: insets.top + 40,
            paddingBottom: insets.bottom + 40,
            paddingLeft: insets.left + SEARCH_PAGE_SIDE_PADDING,
            paddingRight: insets.right + SEARCH_PAGE_SIDE_PADDING,
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {isOffline && (
          <View style={styles.offlineBanner}>
            <IconSymbol name="wifi.slash" size={16} color={WhiteAlpha[90]} />
            <Text style={styles.offlineBannerText}>
              This feature requires a connection. Connect to the internet to use Weightlifting Wrapped.
            </Text>
          </View>
        )}
        <Animated.View entering={FadeInDown.duration(600).delay(100)}>
          <Text style={styles.searchPreTitle}>YOUR</Text>
          <Text style={styles.searchTitle}>
YEAR IN
{"\n"}
LIFTING
</Text>
          <View style={styles.searchTitleAccent} />
        </Animated.View>

        <Animated.View entering={FadeInUp.duration(500).delay(300)} style={styles.searchCard}>
          <Text style={styles.inputLabel}>ATHLETE NAME</Text>
          <View style={styles.inputWrapper}>
            <IconSymbol name="magnifyingglass" size={18} color={WhiteAlpha[50]} />
            <TextInput
              style={styles.searchInput}
              placeholder="Start typing a name..."
              placeholderTextColor={WhiteAlpha[30]}
              value={searchQuery}
              onChangeText={onSearchTextChange}
              autoCapitalize="words"
              autoCorrect={false}
              spellCheck={false}
              returnKeyType="search"
              onSubmitEditing={searchAthlete}
            />
            {loadingSuggestions && (
              <ActivityIndicator size="small" color={WhiteAlpha[50]} style={styles.suggestionsSpinner} />
            )}
          </View>
          {showSuggestions && suggestions.length > 0 && (
            <View style={styles.suggestionsContainer}>
              {didYouMean && <Text style={[styles.inputLabel, styles.didYouMeanLabel]}>DID YOU MEAN…</Text>}
              {suggestions.map((name) => (
                <Pressable
                  key={name}
                  style={({ pressed }) => [styles.suggestionRow, pressed && styles.suggestionRowPressed]}
                  onPress={() => selectSuggestion(name)}
                  accessibilityRole="button"
                  accessibilityLabel={name}
                >
                  <IconSymbol name="magnifyingglass" size={14} color={WhiteAlpha[35]} />
                  <Text style={styles.suggestionText} numberOfLines={1}>{name}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <Text style={styles.inputLabel}>SELECT YEAR</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.yearRow}
            style={styles.yearScroll}
          >
            {YEARS.map((year) => {
              const isSelected = selectedYear === year;
              return (
                <Pressable
                  key={year}
                  onPress={() => setSelectedYear(year)}
                  disabled={loading}
                  style={[styles.yearPill, isSelected && styles.yearPillActive]}
                  accessibilityRole="button"
                  accessibilityLabel={String(year)}
                  accessibilityState={{ selected: isSelected, disabled: loading }}
                >
                  <Text style={[styles.yearPillText, isSelected && styles.yearPillTextActive]}>
                    {year}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable
            style={({ pressed }) => [styles.unwrapButton, pressed && { opacity: 0.85 }]}
            onPress={searchAthlete}
            disabled={loading || isOffline}
            accessibilityRole="button"
            accessibilityLabel="Unwrap my year"
            accessibilityState={{ busy: loading, disabled: loading || isOffline }}
          >
            <LinearGradient
              colors={WrappedGradients.greenButton}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.unwrapButtonGradient}
            >
              {loading ? (
                <ActivityIndicator color={Palette.black} size="small" />
              ) : (
                <Text style={styles.unwrapButtonText}>UNWRAP MY YEAR</Text>
              )}
            </LinearGradient>
          </Pressable>
        </Animated.View>

        <Animated.View entering={FadeIn.duration(500).delay(600)}>
          <Text style={styles.searchFooter}>
            Discover your year in weightlifting.
{"\n"}
See your stats in a shareable format.
</Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  backNavButton: {
    position: "absolute",
    left: 16,
    zIndex: 10,
  },
  backNavButtonBg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: WhiteAlpha[10],
    alignItems: "center",
    justifyContent: "center",
  },
  searchScroll: {
    flex: 1,
  },
  searchScrollContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  searchPreTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: WrappedPalette.green,
    letterSpacing: 6,
    marginBottom: 4,
  },
  searchTitle: {
    fontSize: 52,
    fontWeight: "900",
    color: Palette.white,
    lineHeight: 54,
    marginBottom: 12,
  },
  searchTitleAccent: {
    width: 48,
    height: 4,
    backgroundColor: WrappedPalette.green,
    borderRadius: 2,
    marginBottom: 36,
  },
  searchCard: {
    backgroundColor: WhiteAlpha[7],
    borderRadius: 20,
    padding: 24,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: WhiteAlpha[8],
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: WhiteAlpha[50],
    letterSpacing: 2,
    marginBottom: 10,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: WhiteAlpha[8],
    borderRadius: 12,
    paddingHorizontal: 14,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: WhiteAlpha[10],
  },
  searchInput: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 10,
    fontSize: 16,
    color: Palette.white,
    fontWeight: "500",
  },
  suggestionsSpinner: {
    marginRight: 4,
  },
  yearScroll: {
    marginBottom: 16,
  },
  yearRow: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  yearPill: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 24,
    backgroundColor: WhiteAlpha[6],
    borderWidth: 1,
    borderColor: WhiteAlpha[10],
  },
  yearPillActive: {
    backgroundColor: WrappedPalette.green,
    borderColor: WrappedPalette.green,
  },
  yearPillText: {
    fontSize: 14,
    fontWeight: "600",
    color: WhiteAlpha[50],
  },
  yearPillTextActive: {
    color: Palette.black,
    fontWeight: "800",
  },
  unwrapButton: {
    borderRadius: 30,
    overflow: "hidden",
  },
  unwrapButtonGradient: {
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 30,
  },
  unwrapButtonText: {
    fontSize: 16,
    fontWeight: "900",
    color: Palette.black,
    letterSpacing: 2,
  },
  searchFooter: {
    fontSize: 14,
    color: WhiteAlpha[35],
    textAlign: "center",
    lineHeight: 22,
  },
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: WrappedPalette.offlineBannerBackground,
    borderWidth: 1,
    borderColor: WrappedPalette.offlineBannerBorder,
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
  },
  offlineBannerText: {
    flex: 1,
    fontSize: 14,
    color: WhiteAlpha[95],
    lineHeight: 20,
  },
  suggestionsContainer: {
    backgroundColor: BlackAlpha[45],
    borderRadius: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: WhiteAlpha[8],
    overflow: "hidden",
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 14,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: WhiteAlpha[6],
  },
  suggestionRowPressed: {
    backgroundColor: WhiteAlpha[8],
  },
  didYouMeanLabel: {
    paddingHorizontal: 14,
    paddingTop: 12,
    marginBottom: 4,
  },
  suggestionText: {
    fontSize: 15,
    fontWeight: "500",
    color: WhiteAlpha[85],
    flex: 1,
  },
});
