import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { LiftResult } from "@/data/types/athletes";
import { useAppColors } from "@/hooks/useAppColors";
import { getCloseIcon, STARRED_CLUBS_FILTER } from "@/lib/start-list-utils";
import { FlashList } from "@shopify/flash-list";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FilterSheet from "./FilterSheet";

interface ClubFilterModalProps {
  visible: boolean;
  onClose: () => void;
  athletes: LiftResult[];
  starredClubs: string[];
  onToggleStarredClub: (club: string) => void;
  selectedClub: string;
  onSelectClub: (club: string) => void;
}

const ClubFilterModal: React.FC<ClubFilterModalProps> = ({
  visible,
  onClose,
  athletes,
  starredClubs,
  onToggleStarredClub,
  selectedClub,
  onSelectClub,
}) => {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const [searchQuery, setSearchQuery] = useState("");

  const sortedClubOptions = useMemo(() => {
    const clubs = Array.from(new Set(athletes.map((a) => a.club))).filter(
      Boolean,
    );
    return clubs.sort((a, b) => {
      const aStarred = starredClubs.includes(a);
      const bStarred = starredClubs.includes(b);
      if (aStarred && !bStarred) return -1;
      if (!aStarred && bStarred) return 1;
      return a.localeCompare(b);
    });
  }, [athletes, starredClubs]);

  const filteredClubs = useMemo(
    () =>
      sortedClubOptions.filter((club) =>
        club.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [sortedClubOptions, searchQuery],
  );

  // The sheet stays mounted (`Modal visible=`), so a query typed and then
  // abandoned via the backdrop, the close button or hardware back survived and
  // reopened the sheet pre-filtered — sometimes to zero rows. Selecting a club
  // cleared it; its sibling dismissal paths did not.
  useEffect(() => {
    if (!visible) setSearchQuery("");
  }, [visible]);

  // `starredClubs.includes(club)` was evaluated twice per row. It is a user's
  // own favourites list (small), but the set makes the row render O(1) and is
  // built once per open rather than once per row.
  const starredClubSet = useMemo(() => new Set(starredClubs), [starredClubs]);

  const handleSelect = useCallback(
    (club: string) => {
      onSelectClub(club);
      setSearchQuery("");
      onClose();
    },
    [onClose, onSelectClub],
  );

  const clubKeyExtractor = useCallback((club: string) => club, []);

  const renderClub = useCallback(
    ({ item: club }: { item: string }) => {
      const isSelected = selectedClub === club;
      const isStarred = starredClubSet.has(club);
      return (
        <Pressable
          style={({ pressed }) => [
            styles.option,
            { borderBottomColor: colors.border },
            isSelected && { backgroundColor: colors.pressed },
            pressed && { opacity: 0.8 },
          ]}
          onPress={() => handleSelect(club)}
        >
          <ThemedText
            style={[
              styles.optionText,
              { color: isSelected ? colors.link : colors.text },
            ]}
            numberOfLines={2}
          >
            {club}
          </ThemedText>
          <View style={styles.optionRight}>
            {isSelected && (
              <IconSymbol name="checkmark" size={16} color={colors.link} />
            )}
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                onToggleStarredClub(club);
              }}
              style={styles.starButton}
            >
              <IconSymbol
                name={isStarred ? "star.fill" : "star"}
                size={20}
                color={isStarred ? "#FFB340" : colors.secondaryText}
              />
            </Pressable>
          </View>
        </Pressable>
      );
    },
    [
      colors.border,
      colors.link,
      colors.pressed,
      colors.secondaryText,
      colors.text,
      handleSelect,
      onToggleStarredClub,
      selectedClub,
      starredClubSet,
    ],
  );

  // The two fixed rows above the club list. They scroll with it, exactly as
  // they did when everything lived in one `ScrollView`.
  const listHeader = (
    <>
      <Pressable
        style={({ pressed }) => [
          styles.option,
          { borderBottomColor: colors.border },
          selectedClub === "" && { backgroundColor: colors.pressed },
          pressed && { opacity: 0.8 },
        ]}
        onPress={() => handleSelect("")}
      >
        <ThemedText
          style={[
            styles.optionText,
            { color: selectedClub === "" ? colors.link : colors.text },
          ]}
        >
          All Clubs
        </ThemedText>
        {selectedClub === "" && (
          <IconSymbol name="checkmark" size={16} color={colors.link} />
        )}
      </Pressable>

      {starredClubs.length > 0 && (
        <Pressable
          style={({ pressed }) => [
            styles.option,
            { borderBottomColor: colors.border },
            selectedClub === STARRED_CLUBS_FILTER && {
              backgroundColor: colors.pressed,
            },
            pressed && { opacity: 0.8 },
          ]}
          onPress={() => handleSelect(STARRED_CLUBS_FILTER)}
        >
          <View style={styles.optionContent}>
            <ThemedText
              style={[
                styles.optionText,
                {
                  color:
                    selectedClub === STARRED_CLUBS_FILTER
                      ? colors.link
                      : colors.text,
                },
              ]}
            >
              Favorites
            </ThemedText>
            <IconSymbol name="star.fill" size={20} color="#FFB340" />
          </View>
          {selectedClub === STARRED_CLUBS_FILTER && (
            <IconSymbol name="checkmark" size={16} color={colors.link} />
          )}
        </Pressable>
      )}
    </>
  );

  return (
    <FilterSheet
      visible={visible}
      onClose={onClose}
      header={
        <View
          style={[styles.header, { borderBottomColor: colors.border }]}
        >
          <ThemedText style={styles.headerTitle}>Club</ThemedText>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.closeButton,
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Close club filter"
          >
            <IconSymbol name={getCloseIcon()} size={18} color={colors.text} />
          </Pressable>
        </View>
      }
    >
      <View
        style={[
          styles.searchContainer,
          { borderBottomColor: colors.border },
        ]}
      >
        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: colors.pressed,
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
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
            spellCheck={false}
          />
          {searchQuery.length > 0 && (
            <Pressable
              onPress={() => setSearchQuery("")}
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

      {/*
        A national meet's roster is ~1562 athletes across roughly 550
        distinct clubs (88 clubs for the largest meet currently in the
        window, at 2.8 athletes per club). The previous `ScrollView` +
        `filteredClubs.map(...)` mounted a `Pressable`, a nested star
        `Pressable` and up to two native `IconSymbol` views for every one
        of them in a single synchronous pass when the sheet opened. This
        is the same size of list — and the same fix — as the 732-row
        national-rankings table.
      */}
      <FlashList
        data={filteredClubs}
        keyExtractor={clubKeyExtractor}
        renderItem={renderClub}
        ListHeaderComponent={listHeader}
        bounces={false}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
      />
    </FilterSheet>
  );
};

export default ClubFilterModal;

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  closeButton: {
    minWidth: 36,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  searchContainer: {
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 8,
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
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionText: {
    fontSize: 17,
    flex: 1,
    marginRight: 16,
  },
  optionContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  optionRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexShrink: 0,
  },
  starButton: {
    padding: 6,
    marginRight: -6,
  },
});
