import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { useAppColors } from "@/hooks/useAppColors";
import {
  getAgeCategory,
  getChevronIcon,
  parseWeightClasses,
  sortWeightClasses,
  STARRED_CLUBS_FILTER,
} from "@/lib/start-list-utils";
import { LiftResult } from "@/data/types/athletes";
import React, { useMemo, useState } from "react";
import {
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

interface FilterModalProps {
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

const FilterModal: React.FC<FilterModalProps> = ({
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
  const [expandedSection, setExpandedSection] = useState<
    "ageGroup" | "weightClass" | "club" | "adaptiveAthlete" | "gender" | null
  >(null);

  // Temporary filter states
  const [tempAgeGroupFilter, setTempAgeGroupFilter] = useState("");
  const [tempWeightClassFilter, setTempWeightClassFilter] = useState("");
  const [tempClubFilter, setTempClubFilter] = useState("");
  const [tempAdaptiveAthleteFilter, setTempAdaptiveAthleteFilter] =
    useState("");
  const [tempGenderFilter, setTempGenderFilter] = useState("");
  const [clubSearchQuery, setClubSearchQuery] = useState("");

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

  // Initialize temp filters when modal opens
  React.useEffect(() => {
    if (visible) {
      setTempWeightClassFilter(weightClassFilter);
      setTempClubFilter(clubFilter);
      setTempAgeGroupFilter(ageGroupFilter);
      setTempAdaptiveAthleteFilter(adaptiveAthleteFilter);
      setTempGenderFilter(genderFilter);
    }
  }, [
    visible,
    weightClassFilter,
    clubFilter,
    ageGroupFilter,
    adaptiveAthleteFilter,
    genderFilter,
  ]);

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
        tempAgeGroupFilter &&
        getAgeCategory(athlete.age) !== tempAgeGroupFilter
      ) {
        return;
      }

      if (tempAdaptiveAthleteFilter) {
        if (
          tempAdaptiveAthleteFilter === "Adaptive Athletes" &&
          athlete.adaptive !== true
        ) {
          return;
        }
        if (
          tempAdaptiveAthleteFilter === "Non-Adaptive Athletes" &&
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

    if (tempGenderFilter) {
      const relevantHeaviest =
        tempGenderFilter.toLowerCase() === "male"
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
        tempGenderFilter &&
        athlete.gender.toLowerCase() !== tempGenderFilter.toLowerCase()
      ) {
        return;
      }

      if (
        tempAgeGroupFilter &&
        getAgeCategory(athlete.age) !== tempAgeGroupFilter
      ) {
        return;
      }

      if (tempAdaptiveAthleteFilter) {
        if (
          tempAdaptiveAthleteFilter === "Adaptive Athletes" &&
          athlete.adaptive !== true
        ) {
          return;
        }
        if (
          tempAdaptiveAthleteFilter === "Non-Adaptive Athletes" &&
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
    tempGenderFilter,
    tempAgeGroupFilter,
    tempAdaptiveAthleteFilter,
    visible,
  ]);

  const tempFilteredAthleteCount = useMemo(() => {
    return athletes.filter((athlete) => {
      const weightClasses = parseWeightClasses(athlete.weightClass);
      const ageCategory = getAgeCategory(athlete.age);
      const genderLower = athlete.gender.toLowerCase();

      const matchesWeightClass = tempWeightClassFilter
        ? weightClasses.includes(tempWeightClassFilter)
        : true;
      const matchesClub = tempClubFilter
        ? tempClubFilter === STARRED_CLUBS_FILTER
          ? starredClubs.includes(athlete.club)
          : athlete.club === tempClubFilter
        : true;
      const matchesAgeGroup = tempAgeGroupFilter
        ? ageCategory === tempAgeGroupFilter
        : true;
      const matchesAdaptiveAthlete = tempAdaptiveAthleteFilter
        ? tempAdaptiveAthleteFilter === "Adaptive Athletes"
          ? athlete.adaptive === true
          : tempAdaptiveAthleteFilter === "Non-Adaptive Athletes"
            ? athlete.adaptive === false
            : true
        : true;
      const matchesGender = tempGenderFilter
        ? genderLower === tempGenderFilter.toLowerCase()
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
    tempWeightClassFilter,
    tempClubFilter,
    tempAgeGroupFilter,
    tempAdaptiveAthleteFilter,
    tempGenderFilter,
    starredClubs,
  ]);

  const handleApply = () => {
    onApplyFilters({
      weightClass: tempWeightClassFilter,
      club: tempClubFilter,
      ageGroup: tempAgeGroupFilter,
      adaptiveAthlete: tempAdaptiveAthleteFilter,
      gender: tempGenderFilter,
    });
    setExpandedSection(null);
    onClose();
  };

  const handleReset = () => {
    setTempWeightClassFilter("");
    setTempClubFilter("");
    setTempAgeGroupFilter("");
    setTempAdaptiveAthleteFilter("");
    setTempGenderFilter("");
    onResetFilters();
  };

  const handleClose = () => {
    setExpandedSection(null);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={handleClose}
    >
      <Pressable
        style={[
          styles.modalOverlay,
          { backgroundColor: colors.modalBackground },
        ]}
        onPress={handleClose}
      >
        <View
          style={[
            styles.modalContent,
            {
              backgroundColor: colors.card,
              maxHeight: windowHeight * 0.8,
            },
          ]}
        >
          <View style={styles.modalScrollContent}>
            <ScrollView bounces={false}>
              {/* Age Group Filter */}
              <View
                style={[
                  styles.filterSection,
                  { borderBottomColor: colors.border },
                ]}
              >
                <Pressable
                  style={({ pressed }) => [
                    styles.filterSectionButton,
                    { borderBottomColor: colors.border },
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() =>
                    setExpandedSection(
                      expandedSection === "ageGroup" ? null : "ageGroup",
                    )
                  }
                >
                  <View style={styles.filterSectionButtonContent}>
                    <View>
                      <ThemedText
                        style={[
                          styles.filterSectionLabel,
                          { color: colors.secondaryText },
                        ]}
                      >
                        Age Group
                      </ThemedText>
                      <ThemedText
                        style={[
                          styles.filterSectionValue,
                          { color: colors.text },
                        ]}
                      >
                        {tempAgeGroupFilter || "All Age Groups"}
                      </ThemedText>
                    </View>
                    <IconSymbol
                      name={getChevronIcon(
                        expandedSection === "ageGroup" ? "down" : "right",
                      )}
                      size={16}
                      color={colors.secondaryText}
                    />
                  </View>
                </Pressable>

                {expandedSection === "ageGroup" && (
                  <ScrollView
                    style={[
                      styles.filterOptions,
                      { maxHeight: maxOptionsHeight },
                    ]}
                    bounces={false}
                    nestedScrollEnabled={true}
                  >
                    <Pressable
                      style={({ pressed }) => [
                        styles.filterOption,
                        { borderBottomColor: colors.border },
                        tempAgeGroupFilter === "" && {
                          backgroundColor: colors.pressed,
                        },
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() => {
                        setTempAgeGroupFilter("");
                        setTempWeightClassFilter("");
                        setExpandedSection(null);
                      }}
                    >
                      <ThemedText
                        style={[
                          styles.filterOptionText,
                          { color: colors.text },
                          tempAgeGroupFilter === "" && { color: colors.link },
                        ]}
                      >
                        All Age Groups
                      </ThemedText>
                      {tempAgeGroupFilter === "" && (
                        <IconSymbol
                          name="checkmark"
                          size={16}
                          color={colors.link}
                        />
                      )}
                    </Pressable>

                    {ageGroupOptions.map((ageGroup) => (
                      <Pressable
                        key={ageGroup}
                        style={({ pressed }) => [
                          styles.filterOption,
                          { borderBottomColor: colors.border },
                          tempAgeGroupFilter === ageGroup && {
                            backgroundColor: colors.pressed,
                          },
                          pressed && { opacity: 0.8 },
                        ]}
                        onPress={() => {
                          setTempAgeGroupFilter(ageGroup);
                          setTempWeightClassFilter("");
                          setExpandedSection(null);
                        }}
                      >
                        <ThemedText
                          style={[
                            styles.filterOptionText,
                            { color: colors.text },
                            tempAgeGroupFilter === ageGroup && {
                              color: colors.link,
                            },
                          ]}
                        >
                          {ageGroup}
                        </ThemedText>
                        {tempAgeGroupFilter === ageGroup && (
                          <IconSymbol
                            name="checkmark"
                            size={16}
                            color={colors.link}
                          />
                        )}
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
              </View>

              {/* Gender Filter */}
              <View
                style={[
                  styles.filterSection,
                  { borderBottomColor: colors.border },
                ]}
              >
                <Pressable
                  style={({ pressed }) => [
                    styles.filterSectionButton,
                    { borderBottomColor: colors.border },
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() =>
                    setExpandedSection(
                      expandedSection === "gender" ? null : "gender",
                    )
                  }
                >
                  <View style={styles.filterSectionButtonContent}>
                    <View>
                      <ThemedText
                        style={[
                          styles.filterSectionLabel,
                          { color: colors.secondaryText },
                        ]}
                      >
                        Gender
                      </ThemedText>
                      <ThemedText
                        style={[
                          styles.filterSectionValue,
                          { color: colors.text },
                        ]}
                      >
                        {tempGenderFilter || "All Genders"}
                      </ThemedText>
                    </View>
                    <IconSymbol
                      name={getChevronIcon(
                        expandedSection === "gender" ? "down" : "right",
                      )}
                      size={16}
                      color={colors.secondaryText}
                    />
                  </View>
                </Pressable>

                {expandedSection === "gender" && (
                  <ScrollView
                    style={[
                      styles.filterOptions,
                      { maxHeight: maxOptionsHeight },
                    ]}
                    bounces={false}
                    nestedScrollEnabled={true}
                  >
                    <Pressable
                      style={({ pressed }) => [
                        styles.filterOption,
                        { borderBottomColor: colors.border },
                        tempGenderFilter === "" && {
                          backgroundColor: colors.pressed,
                        },
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() => {
                        setTempGenderFilter("");
                        setTempWeightClassFilter("");
                        setExpandedSection(null);
                      }}
                    >
                      <ThemedText
                        style={[
                          styles.filterOptionText,
                          { color: colors.text },
                          tempGenderFilter === "" && { color: colors.link },
                        ]}
                      >
                        All Genders
                      </ThemedText>
                      {tempGenderFilter === "" && (
                        <IconSymbol
                          name="checkmark"
                          size={16}
                          color={colors.link}
                        />
                      )}
                    </Pressable>

                    <Pressable
                      style={({ pressed }) => [
                        styles.filterOption,
                        { borderBottomColor: colors.border },
                        tempGenderFilter === "Male" && {
                          backgroundColor: colors.pressed,
                        },
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() => {
                        setTempGenderFilter("Male");
                        setTempWeightClassFilter("");
                        setExpandedSection(null);
                      }}
                    >
                      <ThemedText
                        style={[
                          styles.filterOptionText,
                          { color: colors.text },
                          tempGenderFilter === "Male" && {
                            color: colors.link,
                          },
                        ]}
                      >
                        Male
                      </ThemedText>
                      {tempGenderFilter === "Male" && (
                        <IconSymbol
                          name="checkmark"
                          size={16}
                          color={colors.link}
                        />
                      )}
                    </Pressable>

                    <Pressable
                      style={({ pressed }) => [
                        styles.filterOption,
                        { borderBottomColor: colors.border },
                        tempGenderFilter === "Female" && {
                          backgroundColor: colors.pressed,
                        },
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() => {
                        setTempGenderFilter("Female");
                        setTempWeightClassFilter("");
                        setExpandedSection(null);
                      }}
                    >
                      <ThemedText
                        style={[
                          styles.filterOptionText,
                          { color: colors.text },
                          tempGenderFilter === "Female" && {
                            color: colors.link,
                          },
                        ]}
                      >
                        Female
                      </ThemedText>
                      {tempGenderFilter === "Female" && (
                        <IconSymbol
                          name="checkmark"
                          size={16}
                          color={colors.link}
                        />
                      )}
                    </Pressable>
                  </ScrollView>
                )}
              </View>

              {/* Adaptive Athlete Filter */}
              <View
                style={[
                  styles.filterSection,
                  { borderBottomColor: colors.border },
                ]}
              >
                <Pressable
                  style={({ pressed }) => [
                    styles.filterSectionButton,
                    { borderBottomColor: colors.border },
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() =>
                    setExpandedSection(
                      expandedSection === "adaptiveAthlete"
                        ? null
                        : "adaptiveAthlete",
                    )
                  }
                >
                  <View style={styles.filterSectionButtonContent}>
                    <View>
                      <ThemedText
                        style={[
                          styles.filterSectionLabel,
                          { color: colors.secondaryText },
                        ]}
                      >
                        Adaptive Athlete
                      </ThemedText>
                      <ThemedText
                        style={[
                          styles.filterSectionValue,
                          { color: colors.text },
                        ]}
                      >
                        {tempAdaptiveAthleteFilter || "All Athletes"}
                      </ThemedText>
                    </View>
                    <IconSymbol
                      name={getChevronIcon(
                        expandedSection === "adaptiveAthlete"
                          ? "down"
                          : "right",
                      )}
                      size={16}
                      color={colors.secondaryText}
                    />
                  </View>
                </Pressable>

                {expandedSection === "adaptiveAthlete" && (
                  <ScrollView
                    style={[
                      styles.filterOptions,
                      { maxHeight: maxOptionsHeight },
                    ]}
                    bounces={false}
                    nestedScrollEnabled={true}
                  >
                    <Pressable
                      style={({ pressed }) => [
                        styles.filterOption,
                        { borderBottomColor: colors.border },
                        tempAdaptiveAthleteFilter === "" && {
                          backgroundColor: colors.pressed,
                        },
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() => {
                        setTempAdaptiveAthleteFilter("");
                        setTempWeightClassFilter("");
                        setExpandedSection(null);
                      }}
                    >
                      <ThemedText
                        style={[
                          styles.filterOptionText,
                          { color: colors.text },
                          tempAdaptiveAthleteFilter === "" && {
                            color: colors.link,
                          },
                        ]}
                      >
                        All Athletes
                      </ThemedText>
                      {tempAdaptiveAthleteFilter === "" && (
                        <IconSymbol
                          name="checkmark"
                          size={16}
                          color={colors.link}
                        />
                      )}
                    </Pressable>

                    <Pressable
                      style={({ pressed }) => [
                        styles.filterOption,
                        { borderBottomColor: colors.border },
                        tempAdaptiveAthleteFilter === "Adaptive Athletes" && {
                          backgroundColor: colors.pressed,
                        },
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() => {
                        setTempAdaptiveAthleteFilter("Adaptive Athletes");
                        setTempWeightClassFilter("");
                        setExpandedSection(null);
                      }}
                    >
                      <ThemedText
                        style={[
                          styles.filterOptionText,
                          { color: colors.text },
                          tempAdaptiveAthleteFilter ===
                            "Adaptive Athletes" && { color: colors.link },
                        ]}
                      >
                        Adaptive Athletes
                      </ThemedText>
                      {tempAdaptiveAthleteFilter === "Adaptive Athletes" && (
                        <IconSymbol
                          name="checkmark"
                          size={16}
                          color={colors.link}
                        />
                      )}
                    </Pressable>

                    <Pressable
                      style={({ pressed }) => [
                        styles.filterOption,
                        { borderBottomColor: colors.border },
                        tempAdaptiveAthleteFilter ===
                          "Non-Adaptive Athletes" && {
                          backgroundColor: colors.pressed,
                        },
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() => {
                        setTempAdaptiveAthleteFilter("Non-Adaptive Athletes");
                        setTempWeightClassFilter("");
                        setExpandedSection(null);
                      }}
                    >
                      <ThemedText
                        style={[
                          styles.filterOptionText,
                          { color: colors.text },
                          tempAdaptiveAthleteFilter ===
                            "Non-Adaptive Athletes" && { color: colors.link },
                        ]}
                      >
                        Non-Adaptive Athletes
                      </ThemedText>
                      {tempAdaptiveAthleteFilter ===
                        "Non-Adaptive Athletes" && (
                        <IconSymbol
                          name="checkmark"
                          size={16}
                          color={colors.link}
                        />
                      )}
                    </Pressable>
                  </ScrollView>
                )}
              </View>

              {/* Weight Class Filter */}
              <View
                style={[
                  styles.filterSection,
                  { borderBottomColor: colors.border },
                ]}
              >
                <Pressable
                  style={({ pressed }) => [
                    styles.filterSectionButton,
                    { borderBottomColor: colors.border },
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() =>
                    setExpandedSection(
                      expandedSection === "weightClass"
                        ? null
                        : "weightClass",
                    )
                  }
                >
                  <View style={styles.filterSectionButtonContent}>
                    <View>
                      <ThemedText
                        style={[
                          styles.filterSectionLabel,
                          { color: colors.secondaryText },
                        ]}
                      >
                        Weight Class
                      </ThemedText>
                      <ThemedText
                        style={[
                          styles.filterSectionValue,
                          { color: colors.text },
                        ]}
                      >
                        {tempWeightClassFilter || "All Classes"}
                      </ThemedText>
                    </View>
                    <IconSymbol
                      name={getChevronIcon(
                        expandedSection === "weightClass" ? "down" : "right",
                      )}
                      size={16}
                      color={colors.secondaryText}
                    />
                  </View>
                </Pressable>

                {expandedSection === "weightClass" && (
                  <ScrollView
                    style={[
                      styles.filterOptions,
                      { maxHeight: maxOptionsHeight },
                    ]}
                    bounces={false}
                    nestedScrollEnabled={true}
                  >
                    <Pressable
                      style={({ pressed }) => [
                        styles.filterOption,
                        { borderBottomColor: colors.border },
                        tempWeightClassFilter === "" && {
                          backgroundColor: colors.pressed,
                        },
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() => {
                        setTempWeightClassFilter("");
                        setExpandedSection(null);
                      }}
                    >
                      <ThemedText
                        style={[
                          styles.filterOptionText,
                          { color: colors.text },
                          tempWeightClassFilter === "" && {
                            color: colors.link,
                          },
                        ]}
                      >
                        All Classes
                      </ThemedText>
                      {tempWeightClassFilter === "" && (
                        <IconSymbol
                          name="checkmark"
                          size={16}
                          color={colors.link}
                        />
                      )}
                    </Pressable>
                    {weightClassOptions.map((weightClass) => (
                      <Pressable
                        key={weightClass}
                        style={({ pressed }) => [
                          styles.filterOption,
                          { borderBottomColor: colors.border },
                          tempWeightClassFilter === weightClass && {
                            backgroundColor: colors.pressed,
                          },
                          pressed && { opacity: 0.8 },
                        ]}
                        onPress={() => {
                          setTempWeightClassFilter(weightClass);
                          setExpandedSection(null);
                        }}
                      >
                        <ThemedText
                          style={[
                            styles.filterOptionText,
                            { color: colors.text },
                            tempWeightClassFilter === weightClass && {
                              color: colors.link,
                            },
                          ]}
                        >
                          {weightClass.replace("kg", "")}
                          kg
                        </ThemedText>
                        {tempWeightClassFilter === weightClass && (
                          <IconSymbol
                            name="checkmark"
                            size={16}
                            color={colors.link}
                          />
                        )}
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
              </View>

              {/* Club Filter */}
              <View style={styles.filterSection}>
                <Pressable
                  style={({ pressed }) => [
                    styles.filterSectionButton,
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() =>
                    setExpandedSection(
                      expandedSection === "club" ? null : "club",
                    )
                  }
                >
                  <View style={styles.filterSectionButtonContent}>
                    <View>
                      <ThemedText
                        style={[
                          styles.filterSectionLabel,
                          { color: colors.secondaryText },
                        ]}
                      >
                        Club
                      </ThemedText>
                      <ThemedText
                        style={[
                          styles.filterSectionValue,
                          { color: colors.text },
                        ]}
                      >
                        {tempClubFilter || "All Clubs"}
                      </ThemedText>
                    </View>
                    <IconSymbol
                      name={getChevronIcon(
                        expandedSection === "club" ? "down" : "right",
                      )}
                      size={16}
                      color={colors.secondaryText}
                    />
                  </View>
                </Pressable>

                {expandedSection === "club" && (
                  <ScrollView
                    style={[
                      styles.filterOptions,
                      { maxHeight: maxOptionsHeight },
                    ]}
                    bounces={false}
                    nestedScrollEnabled={true}
                  >
                    {/* Add search bar for clubs */}
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
                        tempClubFilter === "" && {
                          backgroundColor: colors.pressed,
                        },
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() => {
                        setTempClubFilter("");
                        setExpandedSection(null);
                      }}
                    >
                      <ThemedText
                        style={[
                          styles.filterOptionText,
                          { color: colors.text },
                          tempClubFilter === "" && { color: colors.link },
                        ]}
                      >
                        All Clubs
                      </ThemedText>
                      {tempClubFilter === "" && (
                        <IconSymbol
                          name="checkmark"
                          size={16}
                          color={colors.link}
                        />
                      )}
                    </Pressable>

                    {/* All Starred Clubs option */}
                    {starredClubs.length > 0 && (
                      <Pressable
                        style={({ pressed }) => [
                          styles.filterOption,
                          { borderBottomColor: colors.border },
                          tempClubFilter === STARRED_CLUBS_FILTER && {
                            backgroundColor: colors.pressed,
                          },
                          pressed && { opacity: 0.8 },
                        ]}
                        onPress={() => {
                          setTempClubFilter(STARRED_CLUBS_FILTER);
                          setExpandedSection(null);
                        }}
                      >
                        <View style={styles.filterOptionContent}>
                          <ThemedText
                            style={[
                              styles.filterOptionText,
                              { color: colors.text },
                              tempClubFilter === STARRED_CLUBS_FILTER && {
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
                        {tempClubFilter === STARRED_CLUBS_FILTER && (
                          <IconSymbol
                            name="checkmark"
                            size={16}
                            color={colors.link}
                          />
                        )}
                      </Pressable>
                    )}

                    {/* Filter clubs based on search query */}
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
                            tempClubFilter === club && {
                              backgroundColor: colors.pressed,
                            },
                            pressed && { opacity: 0.8 },
                          ]}
                          onPress={() => {
                            setTempClubFilter(club);
                            setExpandedSection(null);
                          }}
                        >
                          <ThemedText
                            style={[
                              styles.filterOptionText,
                              { color: colors.text },
                              tempClubFilter === club && {
                                color: colors.link,
                              },
                            ]}
                            numberOfLines={2}
                          >
                            {club}
                          </ThemedText>
                          <View style={styles.filterOptionRight}>
                            {tempClubFilter === club && (
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
                )}
              </View>
            </ScrollView>
          </View>

          <View
            style={[styles.modalFooter, { borderTopColor: colors.border }]}
          >
            <View style={styles.modalFooterContent}>
              <View style={styles.modalFooterRight}>
                <ThemedText
                  style={[
                    styles.resultCount,
                    { color: colors.secondaryText },
                  ]}
                >
                  {tempFilteredAthleteCount} athletes
                </ThemedText>
                <Pressable
                  style={({ pressed }) => [
                    styles.resetButton,
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={handleReset}
                >
                  <ThemedText style={styles.resetButtonText}>
                    Reset
                  </ThemedText>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.applyButton,
                    { backgroundColor: colors.link },
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={handleApply}
                >
                  <ThemedText style={styles.applyButtonText}>
                    Apply
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
};

export default FilterModal;

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
  },
  modalContent: {
    borderRadius: 12,
    overflow: "hidden",
    marginHorizontal: 16,
    maxHeight: "80%",
  },
  modalScrollContent: {
    flexGrow: 1,
  },
  filterSection: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterSectionButton: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterSectionButtonContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  filterSectionLabel: {
    fontSize: 13,
    marginBottom: 4,
  },
  filterSectionValue: {
    fontSize: 17,
    fontWeight: "400",
  },
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
  modalFooter: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  modalFooterContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  modalFooterRight: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },
  resetButton: {
    backgroundColor: "#FF3B30",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  resetButtonText: {
    fontSize: 17,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  resultCount: {
    fontSize: 15,
    marginRight: "auto",
  },
  applyButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
  },
  applyButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
});
