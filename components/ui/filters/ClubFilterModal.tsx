import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { LiftResult } from "@/data/types/athletes";
import { useAppColors } from "@/hooks/useAppColors";
import { getCloseIcon, STARRED_CLUBS_FILTER } from "@/lib/start-list-utils";
import React, { useMemo, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
  const { height: windowHeight } = useWindowDimensions();
  const [searchQuery, setSearchQuery] = useState("");

  const sheetTopOffset = insets.top + 10;

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

  const handleSelect = (club: string) => {
    onSelectClub(club);
    setSearchQuery("");
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.sheetWrapper}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View
          style={[
            styles.sheetContent,
            {
              backgroundColor: colors.card,
              top: sheetTopOffset,
              height: windowHeight - sheetTopOffset,
            },
          ]}
        >
          <View style={styles.handleContainer}>
            <View
              style={[styles.handle, { backgroundColor: colors.borderBottom }]}
            />
          </View>

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

          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          >
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

            {filteredClubs.map((club) => (
              <Pressable
                key={club}
                style={({ pressed }) => [
                  styles.option,
                  { borderBottomColor: colors.border },
                  selectedClub === club && {
                    backgroundColor: colors.pressed,
                  },
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => handleSelect(club)}
              >
                <ThemedText
                  style={[
                    styles.optionText,
                    { color: selectedClub === club ? colors.link : colors.text },
                  ]}
                  numberOfLines={2}
                >
                  {club}
                </ThemedText>
                <View style={styles.optionRight}>
                  {selectedClub === club && (
                    <IconSymbol
                      name="checkmark"
                      size={16}
                      color={colors.link}
                    />
                  )}
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      onToggleStarredClub(club);
                    }}
                    style={styles.starButton}
                  >
                    <IconSymbol
                      name={starredClubs.includes(club) ? "star.fill" : "star"}
                      size={20}
                      color={
                        starredClubs.includes(club)
                          ? "#FFB340"
                          : colors.secondaryText
                      }
                    />
                  </Pressable>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export default ClubFilterModal;

const styles = StyleSheet.create({
  sheetWrapper: {
    flex: 1,
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheetContent: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
  },
  handleContainer: {
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 4,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
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
