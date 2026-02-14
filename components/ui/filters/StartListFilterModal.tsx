import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { LiftResult } from "@/data/types/athletes";
import { useAppColors } from "@/hooks/useAppColors";
import {
  getAgeCategory,
  parseWeightClasses,
  sortWeightClasses,
  STARRED_CLUBS_FILTER,
} from "@/lib/start-list-utils";
import React, { useMemo, useState } from "react";
import {
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import GenericFilterModal, { FilterSection } from "./GenericFilterModal";

interface StartListFilterModalProps {
  visible: boolean;
  onClose: () => void;
  athletes: LiftResult[];
  starredClubs: string[];
  onToggleStarredClub: (club: string) => void;
  weightClassFilter: string;
  clubFilter: string;
  ageGroupFilter: string;
  adaptiveAthleteFilter: string;
  genderFilter: string;
  onApplyFilters: (filters: {
    weightClass: string;
    club: string;
    ageGroup: string;
    adaptiveAthlete: string;
    gender: string;
  }) => void;
  onResetFilters: () => void;
}

const StartListFilterModal: React.FC<StartListFilterModalProps> = ({
  visible,
  onClose,
  athletes,
  starredClubs,
  onToggleStarredClub,
  weightClassFilter,
  clubFilter,
  ageGroupFilter,
  adaptiveAthleteFilter,
  genderFilter,
  onApplyFilters,
  onResetFilters,
}) => {
  const colors = useAppColors();
  const [clubSearchQuery, setClubSearchQuery] = useState("");
  const [tempFilters, setTempFilters] = useState({
    weightClass: "",
    club: "",
    ageGroup: "",
    adaptiveAthlete: "",
    gender: "",
  });

  const windowHeight = Dimensions.get("window").height;
  const maxOptionsHeight = windowHeight * 0.4;

  const ageGroupOptions = [
    "U13",
    "U15",
    "U17",
    "Junior",
    "Senior",
    "Masters 35",
    "Masters 40",
    "Masters 45",
    "Masters 50",
    "Masters 55",
    "Masters 60",
    "Masters 65",
    "Masters 70",
    "Masters 75",
    "Masters 80",
    "Masters 85",
    "Masters 90+",
  ];

  // Initialize temp filters when modal opens (only on visibility change)
  React.useEffect(() => {
    if (visible) {
      setTempFilters({
        weightClass: weightClassFilter,
        club: clubFilter,
        ageGroup: ageGroupFilter,
        adaptiveAthlete: adaptiveAthleteFilter,
        gender: genderFilter,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const clubOptions = useMemo(
    () => Array.from(new Set(athletes.map((a) => a.club))).sort(),
    [athletes],
  );

  const sortedClubOptions = useMemo(() => {
    return [...clubOptions].sort((a, b) => {
      const aIsStarred = starredClubs.includes(a);
      const bIsStarred = starredClubs.includes(b);

      if (aIsStarred && !bIsStarred) return -1;
      if (!aIsStarred && bIsStarred) return 1;

      return a.localeCompare(b);
    });
  }, [clubOptions, starredClubs]);

  const weightClassOptions = useMemo(() => {
    if (!visible) return [];
    const weightClasses = new Set<string>();

    const maleWeightClasses = new Set<string>();
    const femaleWeightClasses = new Set<string>();

    athletes.forEach((athlete) => {
      if (
        tempFilters.ageGroup &&
        getAgeCategory(athlete.age) !== tempFilters.ageGroup
      ) {
        return;
      }

      if (tempFilters.adaptiveAthlete) {
        if (
          tempFilters.adaptiveAthlete === "Adaptive Athletes" &&
          athlete.adaptive !== true
        ) {
          return;
        }
        if (
          tempFilters.adaptiveAthlete === "Non-Adaptive Athletes" &&
          athlete.adaptive !== false
        ) {
          return;
        }
      }

      if (athlete.weightClass) {
        const parsed = parseWeightClasses(athlete.weightClass);
        parsed.forEach((wc) => {
          if (athlete.gender.toLowerCase() === "male") {
            maleWeightClasses.add(wc);
          } else if (athlete.gender.toLowerCase() === "female") {
            femaleWeightClasses.add(wc);
          }
        });
      }
    });

    const getHeaviestWeightClass = (weightClassSet: Set<string>) => {
      const sorted = Array.from(weightClassSet).sort(sortWeightClasses);
      return sorted[sorted.length - 1];
    };

    const heaviestMale = getHeaviestWeightClass(maleWeightClasses);
    const heaviestFemale = getHeaviestWeightClass(femaleWeightClasses);

    const plusClasses = new Set<string>();
    if (heaviestMale) {
      const num = heaviestMale.replace(/\+?kg$/, "");
      plusClasses.add(`${num}+kg`);
    }
    if (heaviestFemale && heaviestFemale !== heaviestMale) {
      const num = heaviestFemale.replace(/\+?kg$/, "");
      plusClasses.add(`${num}+kg`);
    }

    if (tempFilters.gender) {
      const relevantHeaviest =
        tempFilters.gender.toLowerCase() === "male"
          ? heaviestMale
          : heaviestFemale;
      if (relevantHeaviest) {
        const num = relevantHeaviest.replace(/\+?kg$/, "");
        weightClasses.add(`${num}+kg`);
      }
    } else {
      plusClasses.forEach((wc) => weightClasses.add(wc));
    }

    athletes.forEach((athlete) => {
      if (
        tempFilters.gender &&
        athlete.gender.toLowerCase() !== tempFilters.gender.toLowerCase()
      ) {
        return;
      }

      if (
        tempFilters.ageGroup &&
        getAgeCategory(athlete.age) !== tempFilters.ageGroup
      ) {
        return;
      }

      if (tempFilters.adaptiveAthlete) {
        if (
          tempFilters.adaptiveAthlete === "Adaptive Athletes" &&
          athlete.adaptive !== true
        ) {
          return;
        }
        if (
          tempFilters.adaptiveAthlete === "Non-Adaptive Athletes" &&
          athlete.adaptive !== false
        ) {
          return;
        }
      }

      if (athlete.weightClass) {
        const parsed = parseWeightClasses(athlete.weightClass);
        parsed.forEach((wc) => {
          if (wc !== heaviestMale && wc !== heaviestFemale) {
            weightClasses.add(wc);
          }
        });
      }
    });

    const options = Array.from(weightClasses).sort(sortWeightClasses);
    return options;
  }, [
    athletes,
    tempFilters.gender,
    tempFilters.ageGroup,
    tempFilters.adaptiveAthlete,
    visible,
  ]);

  const tempFilteredAthleteCount = useMemo(() => {
    return athletes.filter((athlete) => {
      const weightClasses = parseWeightClasses(athlete.weightClass);
      const ageCategory = getAgeCategory(athlete.age);
      const genderLower = athlete.gender.toLowerCase();

      const matchesWeightClass = tempFilters.weightClass
        ? weightClasses.includes(tempFilters.weightClass)
        : true;
      const matchesClub = tempFilters.club
        ? tempFilters.club === STARRED_CLUBS_FILTER
          ? starredClubs.includes(athlete.club)
          : athlete.club === tempFilters.club
        : true;
      const matchesAgeGroup = tempFilters.ageGroup
        ? ageCategory === tempFilters.ageGroup
        : true;
      const matchesAdaptiveAthlete = tempFilters.adaptiveAthlete
        ? tempFilters.adaptiveAthlete === "Adaptive Athletes"
          ? athlete.adaptive === true
          : tempFilters.adaptiveAthlete === "Non-Adaptive Athletes"
            ? athlete.adaptive === false
            : true
        : true;
      const matchesGender = tempFilters.gender
        ? genderLower === tempFilters.gender.toLowerCase()
        : true;

      return (
        matchesWeightClass &&
        matchesClub &&
        matchesAgeGroup &&
        matchesAdaptiveAthlete &&
        matchesGender
      );
    }).length;
  }, [
    athletes,
    tempFilters,
    starredClubs,
  ]);

  // Build sections for the generic modal
  const sections: FilterSection[] = [
    {
      id: "ageGroup",
      title: "Age Group",
      options: ageGroupOptions.map((ag) => ({ value: ag, label: ag })),
      allOptionLabel: "All Age Groups",
    },
    {
      id: "gender",
      title: "Gender",
      options: [
        { value: "Male", label: "Male" },
        { value: "Female", label: "Female" },
      ],
      allOptionLabel: "All Genders",
    },
    {
      id: "adaptiveAthlete",
      title: "Adaptive Athlete",
      options: [
        { value: "Adaptive Athletes", label: "Adaptive Athletes" },
        { value: "Non-Adaptive Athletes", label: "Non-Adaptive Athletes" },
      ],
      allOptionLabel: "All Athletes",
    },
    {
      id: "weightClass",
      title: "Weight Class",
      options: weightClassOptions.map((wc) => ({
        value: wc,
        label: `${wc.replace("kg", "")}kg`,
      })),
      allOptionLabel: "All Classes",
    },
    {
      id: "club",
      title: "Club",
      options: [],
      allOptionLabel: "All Clubs",
      customContent: (
        <ScrollView
          style={[
            styles.filterOptions,
            { maxHeight: maxOptionsHeight },
          ]}
          bounces={false}
          nestedScrollEnabled={true}
        >
          {/* Search bar */}
          <View
            style={[
              styles.filterSearchContainer,
              { borderBottomColor: colors.border },
            ]}
          >
            <View
              style={[
                styles.filterSearchBar,
                {
                  backgroundColor: colors.borderBottom,
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
                style={[
                  styles.filterSearchInput,
                  { color: colors.text },
                ]}
                placeholder="Search clubs..."
                placeholderTextColor={colors.secondaryText}
                value={clubSearchQuery}
                onChangeText={setClubSearchQuery}
              />
              {clubSearchQuery.length > 0 && (
                <Pressable
                  onPress={() => setClubSearchQuery("")}
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

          {/* All Clubs option */}
          <Pressable
            style={({ pressed }) => [
              styles.filterOption,
              { borderBottomColor: colors.border },
              tempFilters.club === "" && {
                backgroundColor: colors.pressed,
              },
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => {
              setTempFilters((prev) => ({ ...prev, club: "" }));
            }}
          >
            <ThemedText
              style={[
                styles.filterOptionText,
                { color: colors.text },
                tempFilters.club === "" && { color: colors.link },
              ]}
            >
              All Clubs
            </ThemedText>
            {tempFilters.club === "" && (
              <IconSymbol
                name="checkmark"
                size={16}
                color={colors.link}
              />
            )}
          </Pressable>

          {/* Favorites option */}
          {starredClubs.length > 0 && (
            <Pressable
              style={({ pressed }) => [
                styles.filterOption,
                { borderBottomColor: colors.border },
                tempFilters.club === STARRED_CLUBS_FILTER && {
                  backgroundColor: colors.pressed,
                },
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => {
                setTempFilters((prev) => ({ ...prev, club: STARRED_CLUBS_FILTER }));
              }}
            >
              <View style={styles.filterOptionContent}>
                <ThemedText
                  style={[
                    styles.filterOptionText,
                    { color: colors.text },
                    tempFilters.club === STARRED_CLUBS_FILTER && {
                      color: colors.link,
                    },
                  ]}
                >
                  Favorites
                </ThemedText>
                <IconSymbol
                  name="star.fill"
                  size={22}
                  color="#FFB340"
                />
              </View>
              {tempFilters.club === STARRED_CLUBS_FILTER && (
                <IconSymbol
                  name="checkmark"
                  size={16}
                  color={colors.link}
                />
              )}
            </Pressable>
          )}

          {/* Club list */}
          {sortedClubOptions
            .filter((club) =>
              club
                .toLowerCase()
                .includes(clubSearchQuery.toLowerCase()),
            )
            .map((club) => (
              <Pressable
                key={club}
                style={({ pressed }) => [
                  styles.filterOption,
                  { borderBottomColor: colors.border },
                  tempFilters.club === club && {
                    backgroundColor: colors.pressed,
                  },
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => {
                  setTempFilters((prev) => ({ ...prev, club }));
                }}
              >
                <ThemedText
                  style={[
                    styles.filterOptionText,
                    { color: colors.text },
                    tempFilters.club === club && {
                      color: colors.link,
                    },
                  ]}
                  numberOfLines={2}
                >
                  {club}
                </ThemedText>
                <View style={styles.filterOptionRight}>
                  {tempFilters.club === club && (
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
                      name={
                        starredClubs.includes(club)
                          ? "star.fill"
                          : "star"
                      }
                      size={22}
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
      ),
    },
  ];

  return (
    <GenericFilterModal
      visible={visible}
      onClose={onClose}
      sections={sections}
      filters={{
        ageGroup: tempFilters.ageGroup,
        gender: tempFilters.gender,
        adaptiveAthlete: tempFilters.adaptiveAthlete,
        weightClass: tempFilters.weightClass,
        club: tempFilters.club,
      }}
      onApplyFilters={(filters) => {
        onApplyFilters({
          weightClass: filters.weightClass,
          club: filters.club,
          ageGroup: filters.ageGroup,
          adaptiveAthlete: filters.adaptiveAthlete,
          gender: filters.gender,
        });
        setTempFilters({
          weightClass: filters.weightClass,
          club: filters.club,
          ageGroup: filters.ageGroup,
          adaptiveAthlete: filters.adaptiveAthlete,
          gender: filters.gender,
        });
      }}
      onResetFilters={onResetFilters}
      resultCount={tempFilteredAthleteCount}
      resultLabel="athletes"
    />
  );
};

export default StartListFilterModal;

const styles = StyleSheet.create({
  filterOptions: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  filterOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterOptionText: {
    fontSize: 17,
    flex: 1,
    marginRight: 16,
  },
  filterOptionContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  filterOptionRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexShrink: 0,
  },
  starButton: {
    padding: 6,
    marginRight: -6,
  },
  clearButton: {
    padding: 4,
    marginRight: -4,
  },
  filterSearchContainer: {
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterSearchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 8,
  },
  filterSearchInput: {
    flex: 1,
    fontSize: 16,
    padding: 0,
    height: 24,
    marginRight: 8,
  },
});
