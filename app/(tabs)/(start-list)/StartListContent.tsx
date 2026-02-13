import ImagePreviewModal from "@/components/share/ImagePreviewModal";
import ShareScheduleView from "@/components/share/ShareScheduleView";
import {
  AthleteItem,
  SessionDetails,
} from "@/components/start-list/AthleteItem";
import { StartListSkeleton } from "@/components/start-list/StartListSkeleton";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { ExpandedIdProvider } from "@/contexts/ExpandedIdContext";
import { useSavedSessions } from "@/contexts/SavedSessionsContext";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { LiftResult } from "@/data/types/athletes";
import { MeetName } from "@/data/types/meet";
import { useAppColors } from "@/hooks/useAppColors";
import {
  getMeetData,
  saveMeetAthletes,
  saveMeetSchedule,
} from "@/lib/database/offline-store";
import { fetchAthletes, fetchSchedule } from "@/lib/database/queries";
import { isNetworkAvailable } from "@/lib/networkUtils";
import { preloadYearBests } from "@/lib/start-list-api";
import {
  getAgeCategory,
  getChevronIcon,
  getCloseIcon,
  getSaveIcon,
  isMeetName,
  parseWeightClasses,
  requestCalendarPermissions,
  sortAthletes,
  sortWeightClasses,
  STARRED_CLUBS_FILTER,
} from "@/lib/start-list-utils";
import type { Schedule as ScheduleType } from "@/types/schedule";
import { useAuthGuard } from "@/utils/authGuard";
import { createCalendarEvents } from "@/utils/calendar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { FlashList } from "@shopify/flash-list";
import * as FileSystem from "expo-file-system";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Animated,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const REVIEW_COUNT_KEY = "startListFilterApplyCount";
const REVIEW_PROMPTED_KEY = "startListReviewPromptedCounts";
const REVIEW_COUNTS = [5, 50, 100] as const;

export default function StartListScreen() {
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [weightClassFilter, setWeightClassFilter] = useState("");
  const [clubFilter, setClubFilter] = useState("");
  const [ageGroupFilter, setAgeGroupFilter] = useState("");
  const [adaptiveAthleteFilter, setAdaptiveAthleteFilter] = useState("");
  const [genderFilter, setGenderFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [clubSearchQuery, setClubSearchQuery] = useState("");
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { saveSessionsFromAthletes } = useSavedSessions();
  const [starredClubs, setStarredClubs] = useState<string[]>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const { selectedMeet } = useSelectedMeet();
  const { isSubscribed } = useSubscription();
  const { requireAuth } = useAuthGuard();
  const [loading, setLoading] = useState(true);
  const [athletes, setAthletes] = useState<LiftResult[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [scheduleData, setScheduleData] = useState<ScheduleType>([]);
  const loadInFlightRef = useRef<Promise<void> | null>(null);
  const latestLoadIdRef = useRef(0);
  const [generatedImageWhiteUri, setGeneratedImageWhiteUri] = useState<
    string | null
  >(null);
  const [generatedImageTransparentUri, setGeneratedImageTransparentUri] =
    useState<string | null>(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [showImagePreview, setShowImagePreview] = useState(false);
  const [showShareViews, setShowShareViews] = useState(false);
  const shareScheduleRef = useRef<View>(null);
  const shareScheduleTransparentRef = useRef<View>(null);
  const [filterApplyCount, setFilterApplyCount] = useState(0);
  const [reviewPromptedCounts, setReviewPromptedCounts] = useState<number[]>(
    [],
  );
  const skeletonPulse = useRef(new Animated.Value(0.4)).current;

  const loadStoreReview = useCallback(async () => {
    try {
      const module = await import("expo-store-review");
      return module;
    } catch (error) {
      console.warn("StartList: expo-store-review not available", error);
      return null;
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadReviewState = async () => {
      try {
        const [countRaw, promptedRaw] = await Promise.all([
          AsyncStorage.getItem(REVIEW_COUNT_KEY),
          AsyncStorage.getItem(REVIEW_PROMPTED_KEY),
        ]);
        if (!isMounted) return;
        const count = Number(countRaw ?? 0);
        const prompted = promptedRaw ? JSON.parse(promptedRaw) : [];
        setFilterApplyCount(Number.isFinite(count) ? count : 0);
        setReviewPromptedCounts(Array.isArray(prompted) ? prompted : []);
      } catch (error) {
        console.warn("StartList: Failed to load review state", error);
      }
    };
    loadReviewState();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!loading) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(skeletonPulse, {
          toValue: 0.9,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(skeletonPulse, {
          toValue: 0.4,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [loading, skeletonPulse]);

  const requestReviewIfEligible = useCallback(
    async (nextCount: number) => {
      if (!REVIEW_COUNTS.includes(nextCount)) return;
      if (reviewPromptedCounts.includes(nextCount)) return;
      try {
        const StoreReview = await loadStoreReview();
        if (!StoreReview) return;
        const isAvailable = await StoreReview.isAvailableAsync();
        if (!isAvailable) return;
        await StoreReview.requestReview();
        const updated = [...reviewPromptedCounts, nextCount];
        setReviewPromptedCounts(updated);
        await AsyncStorage.setItem(
          REVIEW_PROMPTED_KEY,
          JSON.stringify(updated),
        );
      } catch (error) {
        console.warn("StartList: requestReview failed", error);
      }
    },
    [reviewPromptedCounts, loadStoreReview],
  );

  const loadMeetSnapshot = useCallback(async (meet: MeetName) => {
    const [hasNetwork, cachedMeetData] = await Promise.all([
      isNetworkAvailable(),
      getMeetData(meet).catch(() => null),
    ]);
    return {
      hasNetwork,
      cachedAthletes: cachedMeetData?.athletes ?? [],
      cachedSchedule: cachedMeetData?.schedule ?? [],
    };
  }, []);

  const loadStartListData = useCallback(
    async (forceRefresh = false) => {
      if (!selectedMeet || !isMeetName(selectedMeet)) {
        setAthletes([]);
        setScheduleData([]);
        setLoading(false);
        return;
      }

      if (loadInFlightRef.current) {
        await loadInFlightRef.current;
        return;
      }

      const validMeet = selectedMeet;
      const requestId = ++latestLoadIdRef.current;
      if (!forceRefresh) setLoading(true);

      const requestPromise = (async () => {
        const snapshot = await loadMeetSnapshot(validMeet);

        if (!forceRefresh) {
          setAthletes(snapshot.cachedAthletes);
          setScheduleData(snapshot.cachedSchedule);
        }

        if (!snapshot.hasNetwork) {
          if (!forceRefresh) setLoading(false);
          return;
        }

        const [athletesResult, scheduleResult] = await Promise.allSettled([
          fetchAthletes(validMeet),
          fetchSchedule(validMeet),
        ]);

        if (requestId !== latestLoadIdRef.current) return;

        let nextAthletes = snapshot.cachedAthletes;
        let nextSchedule = snapshot.cachedSchedule;

        if (athletesResult.status === "fulfilled") {
          nextAthletes = athletesResult.value;
          saveMeetAthletes(validMeet, nextAthletes).catch(() => {});
        }

        if (scheduleResult.status === "fulfilled") {
          nextSchedule = scheduleResult.value;
          if (nextSchedule.length > 0) {
            saveMeetSchedule(validMeet, nextSchedule).catch(() => {});
          }
        }

        if (
          athletesResult.status === "rejected" &&
          scheduleResult.status === "rejected" &&
          forceRefresh
        ) {
          Alert.alert(
            "Error",
            "Failed to refresh start list data. Please try again.",
          );
        }

        setAthletes(nextAthletes);
        setScheduleData(nextSchedule);
        if (!forceRefresh) setLoading(false);
      })();

      loadInFlightRef.current = requestPromise;
      try {
        await requestPromise;
      } finally {
        loadInFlightRef.current = null;
      }
    },
    [loadMeetSnapshot, selectedMeet],
  );

  useEffect(() => {
    loadStartListData(false);
  }, [loadStartListData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadStartListData(true);
    } finally {
      setRefreshing(false);
    }
  }, [loadStartListData]);

  const sessionIndex = useMemo(() => {
    const index = new Map<
      number,
      {
        day: ScheduleType[number];
        session: ScheduleType[number]["sessions"][number];
      }
    >();
    for (const day of scheduleData) {
      for (const session of day.sessions) {
        index.set(session.number, { day, session });
      }
    }
    return index;
  }, [scheduleData]);

  const getSessionDetails = useCallback(
    (sessionNumber: number): SessionDetails | null => {
      const indexed = sessionIndex.get(sessionNumber);
      if (!indexed) return null;
      return {
        date: indexed.day.fullDate,
        startTime: indexed.session.startTime,
        weighInTime: indexed.session.weighInTime,
        displayDate: indexed.day.date,
        platforms: indexed.session.platforms,
      };
    },
    [sessionIndex],
  );

  // Add back useEffect for starred clubs
  useEffect(() => {
    const loadStarredClubs = async () => {
      try {
        const stored = await AsyncStorage.getItem("starredClubs");
        if (stored) {
          setStarredClubs(JSON.parse(stored));
        }
      } catch (error) {
        console.error("Error loading starred clubs:", error);
      }
    };
    loadStarredClubs();
  }, []);

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

  const renderListItem = useCallback(
    ({ item }: { item: LiftResult }) => (
      <AthleteItem
        athlete={item}
        router={router}
        getSessionDetails={getSessionDetails}
      />
    ),
    [router, getSessionDetails],
  );

  const keyExtractor = useCallback(
    (item: LiftResult) => `${item.memberId}_${item.name}`,
    [],
  );

  // Add new state for age group filter
  const [expandedSection, setExpandedSection] = useState<
    "ageGroup" | "weightClass" | "club" | "adaptiveAthlete" | "gender" | null
  >(null);

  // Add new state for temporary filters
  const [tempAgeGroupFilter, setTempAgeGroupFilter] = useState("");
  const [tempWeightClassFilter, setTempWeightClassFilter] = useState("");
  const [tempClubFilter, setTempClubFilter] = useState("");
  const [tempAdaptiveAthleteFilter, setTempAdaptiveAthleteFilter] =
    useState("");
  const [tempGenderFilter, setTempGenderFilter] = useState("");

  const weightClassOptions = useMemo(() => {
    if (!showFilterModal) return [];
    const weightClasses = new Set<string>();

    // First, collect all weight classes and separate by gender and age group to identify heaviest classes
    const maleWeightClasses = new Set<string>();
    const femaleWeightClasses = new Set<string>();

    athletes.forEach((athlete) => {
      // Filter by age group if one is selected
      if (
        tempAgeGroupFilter &&
        getAgeCategory(athlete.age) !== tempAgeGroupFilter
      ) {
        return; // Skip athletes that don't match the selected age group
      }

      // Filter by adaptive athlete status if one is selected
      if (tempAdaptiveAthleteFilter) {
        if (
          tempAdaptiveAthleteFilter === "Adaptive Athletes" &&
          athlete.adaptive !== true
        ) {
          return; // Skip non-adaptive athletes when adaptive filter is selected
        }
        if (
          tempAdaptiveAthleteFilter === "Non-Adaptive Athletes" &&
          athlete.adaptive !== false
        ) {
          return; // Skip adaptive athletes when non-adaptive filter is selected
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

    // Find the heaviest weight class for each gender (within the age group and adaptive filters)
    const getHeaviestWeightClass = (weightClassSet: Set<string>) => {
      const sorted = Array.from(weightClassSet).sort(sortWeightClasses);
      return sorted[sorted.length - 1];
    };

    const heaviestMale = getHeaviestWeightClass(maleWeightClasses);
    const heaviestFemale = getHeaviestWeightClass(femaleWeightClasses);

    // Convert heaviest classes to plus classes
    const plusClasses = new Set<string>();
    if (heaviestMale) {
      const num = heaviestMale.replace(/\+?kg$/, ""); // Remove + and kg
      plusClasses.add(`${num}+kg`);
    }
    if (heaviestFemale && heaviestFemale !== heaviestMale) {
      const num = heaviestFemale.replace(/\+?kg$/, ""); // Remove + and kg
      plusClasses.add(`${num}+kg`);
    }

    // Add plus classes based on gender filter
    if (tempGenderFilter) {
      // If a gender is selected, only add the plus class for that gender
      const relevantHeaviest =
        tempGenderFilter.toLowerCase() === "male"
          ? heaviestMale
          : heaviestFemale;
      if (relevantHeaviest) {
        const num = relevantHeaviest.replace(/\+?kg$/, "");
        weightClasses.add(`${num}+kg`);
      }
    } else {
      // If no gender filter, add all plus classes
      plusClasses.forEach((wc) => weightClasses.add(wc));
    }

    // Then add gender-specific regular weight classes (excluding the heaviest ones)
    athletes.forEach((athlete) => {
      // Filter by gender if one is selected
      if (
        tempGenderFilter &&
        athlete.gender.toLowerCase() !== tempGenderFilter.toLowerCase()
      ) {
        return; // Skip athletes that don't match the selected gender
      }

      // Filter by age group if one is selected
      if (
        tempAgeGroupFilter &&
        getAgeCategory(athlete.age) !== tempAgeGroupFilter
      ) {
        return; // Skip athletes that don't match the selected age group
      }

      // Filter by adaptive athlete status if one is selected
      if (tempAdaptiveAthleteFilter) {
        if (
          tempAdaptiveAthleteFilter === "Adaptive Athletes" &&
          athlete.adaptive !== true
        ) {
          return; // Skip non-adaptive athletes when adaptive filter is selected
        }
        if (
          tempAdaptiveAthleteFilter === "Non-Adaptive Athletes" &&
          athlete.adaptive !== false
        ) {
          return; // Skip adaptive athletes when non-adaptive filter is selected
        }
      }

      if (athlete.weightClass) {
        const parsed = parseWeightClasses(athlete.weightClass);
        parsed.forEach((wc) => {
          // Don't add the heaviest weight classes as regular classes since they're now plus classes
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
    showFilterModal,
  ]);

  // Update getFilterDisplayText to handle age group
  const getFilterDisplayText = () => {
    const filters = [];
    if (weightClassFilter) filters.push(weightClassFilter);
    if (clubFilter)
      filters.push(
        clubFilter === STARRED_CLUBS_FILTER ? "Starred Clubs" : clubFilter,
      );
    if (ageGroupFilter) filters.push(ageGroupFilter);
    if (adaptiveAthleteFilter) filters.push(adaptiveAthleteFilter);
    if (genderFilter) filters.push(genderFilter);

    return filters.length > 0 ? filters.join(" • ") : "Filter";
  };

  const normalizedAthletes = useMemo(() => {
    return athletes.map((athlete) => ({
      athlete,
      nameLower: athlete.name.toLowerCase(),
      weightClasses: parseWeightClasses(athlete.weightClass),
      ageCategory: getAgeCategory(athlete.age),
      genderLower: athlete.gender.toLowerCase(),
    }));
  }, [athletes]);

  const filteredAthletes = useMemo(() => {
    const search = searchQuery.toLowerCase();
    const gender = genderFilter.toLowerCase();

    return normalizedAthletes
      .filter(
        ({ athlete, nameLower, weightClasses, ageCategory, genderLower }) => {
          const matchesWeightClass = weightClassFilter
            ? weightClasses.includes(weightClassFilter)
            : true;
          const matchesClub = clubFilter
            ? clubFilter === STARRED_CLUBS_FILTER
              ? starredClubs.includes(athlete.club)
              : athlete.club === clubFilter
            : true;
          const matchesSearch = search ? nameLower.includes(search) : true;
          const matchesAgeGroup = ageGroupFilter
            ? ageCategory === ageGroupFilter
            : true;
          const matchesAdaptiveAthlete = adaptiveAthleteFilter
            ? adaptiveAthleteFilter === "Adaptive Athletes"
              ? athlete.adaptive === true
              : adaptiveAthleteFilter === "Non-Adaptive Athletes"
                ? athlete.adaptive === false
                : true
            : true;
          const matchesGender = gender ? genderLower === gender : true;

          return (
            matchesWeightClass &&
            matchesClub &&
            matchesSearch &&
            matchesAgeGroup &&
            matchesAdaptiveAthlete &&
            matchesGender
          );
        },
      )
      .map(({ athlete }) => athlete)
      .sort(sortAthletes);
  }, [
    normalizedAthletes,
    weightClassFilter,
    clubFilter,
    searchQuery,
    ageGroupFilter,
    adaptiveAthleteFilter,
    genderFilter,
    starredClubs,
  ]);

  const tempFilteredAthleteCount = useMemo(() => {
    const search = searchQuery.toLowerCase();
    const gender = tempGenderFilter.toLowerCase();

    return normalizedAthletes.filter(
      ({ athlete, nameLower, weightClasses, ageCategory, genderLower }) => {
        const matchesWeightClass = tempWeightClassFilter
          ? weightClasses.includes(tempWeightClassFilter)
          : true;
        const matchesClub = tempClubFilter
          ? tempClubFilter === STARRED_CLUBS_FILTER
            ? starredClubs.includes(athlete.club)
            : athlete.club === tempClubFilter
          : true;
        const matchesSearch = search ? nameLower.includes(search) : true;
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
        const matchesGender = gender ? genderLower === gender : true;

        return (
          matchesWeightClass &&
          matchesClub &&
          matchesSearch &&
          matchesAgeGroup &&
          matchesAdaptiveAthlete &&
          matchesGender
        );
      },
    ).length;
  }, [
    normalizedAthletes,
    searchQuery,
    starredClubs,
    tempWeightClassFilter,
    tempClubFilter,
    tempAgeGroupFilter,
    tempAdaptiveAthleteFilter,
    tempGenderFilter,
  ]);

  useEffect(() => {
    if (athletes.length === 0) return;
    const firstNameStartsWithA = (a: LiftResult) =>
      ((a.name || "").trim().split(/\s+/)[0] || "")
        .toUpperCase()
        .startsWith("A");
    const aNames = athletes.filter(firstNameStartsWithA).map((a) => a.name);
    if (aNames.length === 0) return;
    const t = setTimeout(() => preloadYearBests(aNames.slice(0, 80)), 500);
    return () => clearTimeout(t);
  }, [athletes]);

  const windowHeight = Dimensions.get("window").height;
  const maxOptionsHeight = windowHeight * 0.4; // 40% of screen height

  const buildSessionExportRows = useCallback(() => {
    return filteredAthletes
      .filter((athlete) => athlete.session)
      .map((athlete) => {
        const sessionNumber = athlete.session!.number;
        const sessionDetails = getSessionDetails(sessionNumber);
        if (!sessionDetails) return null;

        const platformDetails = sessionDetails.platforms.find(
          (platform) => platform.platform === athlete.session?.platform,
        );
        const startTime =
          platformDetails?.platformStartTime || sessionDetails.startTime;

        return {
          athlete,
          sessionNumber,
          platform: athlete.session?.platform || "",
          date: sessionDetails.date,
          displayDate: sessionDetails.displayDate,
          startTime,
          weighInTime: sessionDetails.weighInTime,
          weightClass: athlete.weightClass,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row != null);
  }, [filteredAthletes, getSessionDetails]);

  const handleSaveAll = async () => {
    if (!selectedMeet || !isMeetName(selectedMeet)) {
      Alert.alert("Error", "Please select a meet before saving sessions.");
      return;
    }

    const validMeet = selectedMeet;

    Alert.alert(
      "Save Sessions",
      `Save sessions from ${filteredAthletes.length} athlete${filteredAthletes.length === 1 ? "" : "s"} to your saved list?`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Save",
          onPress: async () => {
            try {
              const success = await saveSessionsFromAthletes(
                filteredAthletes,
                validMeet,
              );
              if (success) {
                Alert.alert(
                  "Success",
                  "Sessions have been saved to your list.",
                  [
                    {
                      text: "View Saved",
                      onPress: () => router.push("/(tabs)/(saved)"),
                    },
                    {
                      text: "OK",
                    },
                  ],
                );
              } else {
                Alert.alert("Error", "Failed to save sessions.");
              }
            } catch (error) {
              Alert.alert("Error", "Failed to save sessions.");
              console.error(error);
            }
          },
        },
      ],
    );
  };

  const handleSaveToCalendar = async () => {
    if (!isSubscribed) {
      router.push("/paywall");
      return;
    }

    if (!selectedMeet || !isMeetName(selectedMeet)) {
      Alert.alert(
        "Error",
        "Please select a meet before adding events to calendar.",
      );
      return;
    }

    const sessionsToAdd = buildSessionExportRows().map((row) => ({
      date: row.date,
      startTime: row.startTime,
      weighInTime: row.weighInTime,
      sessionNumber: row.sessionNumber.toString(),
      platform: row.platform,
      weightClass: row.weightClass,
      meet: selectedMeet,
    }));

    if (sessionsToAdd.length === 0) {
      Alert.alert("No Sessions", "There are no sessions to add to calendar.");
      return;
    }

    Alert.alert(
      "Add to Calendar",
      `Add ${sessionsToAdd.length} session${sessionsToAdd.length === 1 ? "" : "s"} to your calendar?`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Add",
          onPress: async () => {
            try {
              const hasPermission = await requestCalendarPermissions();
              if (!hasPermission) {
                Alert.alert(
                  "Permission Required",
                  "Calendar permission is required to add sessions.",
                );
                return;
              }
              await createCalendarEvents(sessionsToAdd);
              Alert.alert(
                "Success",
                "Sessions have been added to your calendar.",
              );
            } catch (error) {
              Alert.alert(
                "Error",
                error instanceof Error
                  ? error.message
                  : "Failed to add sessions to calendar.",
              );
              console.error(error);
            }
          },
        },
      ],
    );
  };

  // Update the age group options
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

  // Update modal open handler
  const handleOpenModal = () => {
    setTempWeightClassFilter(weightClassFilter);
    setTempClubFilter(clubFilter);
    setTempAgeGroupFilter(ageGroupFilter);
    setTempAdaptiveAthleteFilter(adaptiveAthleteFilter);
    setTempGenderFilter(genderFilter);
    setShowFilterModal(true);
  };

  // Update apply handler
  const handleApplyFilters = () => {
    setWeightClassFilter(tempWeightClassFilter);
    setClubFilter(tempClubFilter);
    setAgeGroupFilter(tempAgeGroupFilter);
    setAdaptiveAthleteFilter(tempAdaptiveAthleteFilter);
    setGenderFilter(tempGenderFilter);
    setShowFilterModal(false);
    setExpandedSection(null);

    const nextCount = filterApplyCount + 1;
    setFilterApplyCount(nextCount);
    AsyncStorage.setItem(REVIEW_COUNT_KEY, String(nextCount)).catch((error) => {
      console.warn("StartList: Failed to persist filter apply count", error);
    });
    requestReviewIfEligible(nextCount);
  };

  // Add resetFilters function before the return statement
  const resetFilters = () => {
    setTempWeightClassFilter("");
    setTempClubFilter("");
    setTempAgeGroupFilter("");
    setTempAdaptiveAthleteFilter("");
    setTempGenderFilter("");
    setWeightClassFilter("");
    setClubFilter("");
    setAgeGroupFilter("");
    setAdaptiveAthleteFilter("");
    setGenderFilter("");
    setSearchQuery("");
    setShowFilterModal(false);
    setExpandedSection(null);
  };

  // Add back toggleStarredClub function
  const toggleStarredClub = async (club: string) => {
    try {
      const newStarredClubs = starredClubs.includes(club)
        ? starredClubs.filter((c) => c !== club)
        : [...starredClubs, club];

      setStarredClubs(newStarredClubs);
      await AsyncStorage.setItem(
        "starredClubs",
        JSON.stringify(newStarredClubs),
      );
    } catch (error) {
      console.error("Error saving starred clubs:", error);
    }
  };

  // Capture schedule image for sharing
  const captureScheduleImage = async () => {
    // Validate that a specific club is selected
    if (
      !tempClubFilter ||
      tempClubFilter === "" ||
      tempClubFilter === STARRED_CLUBS_FILTER
    ) {
      Alert.alert(
        "Select a Club",
        "Please select a specific club from the filters to create a shareable schedule.",
      );
      return;
    }

    // Ensure there are filtered athletes
    if (filteredAthletes.length === 0) {
      Alert.alert(
        "Nothing to Share",
        "No athletes were found for the current filters.",
      );
      return;
    }

    try {
      // Dynamically import captureRef to avoid native module errors on startup
      const { captureRef } = await import("react-native-view-shot");
      setShowShareViews(true);
      await new Promise((resolve) =>
        requestAnimationFrame(() => resolve(null)),
      );

      if (!shareScheduleRef.current || !shareScheduleTransparentRef.current) {
        setShowShareViews(false);
        Alert.alert(
          "Error",
          "Failed to generate schedule image. Please try again.",
        );
        return;
      }

      // Add a small delay to ensure the view is fully rendered
      await new Promise((resolve) => setTimeout(resolve, 100));

      const whiteUri = await captureRef(shareScheduleRef.current, {
        format: "png",
        quality: 1.0,
        result: "tmpfile",
        width: 850,
        height: undefined,
      });
      const transparentUri = await captureRef(
        shareScheduleTransparentRef.current,
        {
          format: "png",
          quality: 1.0,
          result: "tmpfile",
          width: 850,
          height: undefined,
        },
      );
      setGeneratedImageWhiteUri(whiteUri);
      setGeneratedImageTransparentUri(transparentUri);
      setSelectedImageIndex(0);
      setShowImagePreview(true);
    } catch (error) {
      setShowShareViews(false);
      console.error("Error capturing image:", error);
      Alert.alert(
        "Error",
        "Failed to generate schedule image. Please try again.",
      );
    }
  };

  const generateShareableScheduleCsv = async () => {
    if (
      !tempClubFilter ||
      tempClubFilter === "" ||
      tempClubFilter === STARRED_CLUBS_FILTER
    ) {
      Alert.alert(
        "Select a Club",
        "Please select a specific club from the filters to create a shareable schedule.",
      );
      return;
    }

    if (filteredAthletes.length === 0) {
      Alert.alert(
        "Nothing to Share",
        "No athletes were found for the current filters.",
      );
      return;
    }

    const formatTime = (time: string) => {
      if (!time) return "";
      if (time.includes("AM") || time.includes("PM")) {
        return time;
      }
      const [hours, minutes] = time.split(":").map(Number);
      if (Number.isNaN(hours) || Number.isNaN(minutes)) return time;
      const period = hours >= 12 ? "PM" : "AM";
      const hour12 = hours % 12 || 12;
      return `${hour12}:${minutes.toString().padStart(2, "0")} ${period}`;
    };

    const formatDate = (dateString: string) => {
      if (!dateString) return "";
      const isoDateMatch = dateString.match(/^(\d{4})-(\d{2})-(\d{2})/);
      const formatOptions: Intl.DateTimeFormatOptions = {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      };

      if (isoDateMatch) {
        const [, yearRaw, monthRaw, dayRaw] = isoDateMatch;
        const year = Number(yearRaw);
        const month = Number(monthRaw);
        const day = Number(dayRaw);
        if (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(day)) {
          return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(
            "en-US",
            formatOptions,
          );
        }
      }

      const parsed = new Date(dateString);
      if (Number.isNaN(parsed.getTime())) return dateString;
      return parsed.toLocaleDateString("en-US", formatOptions);
    };

    const csvEscape = (value: string) => {
      const escaped = value.replace(/"/g, '""');
      return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
    };

    const sanitizeFileName = (value: string) =>
      value
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();

    const groupedByDate: Record<
      string,
      { athlete: LiftResult; startTime: string }[]
    > = {};
    for (const row of buildSessionExportRows()) {
      if (!groupedByDate[row.date]) {
        groupedByDate[row.date] = [];
      }
      groupedByDate[row.date].push({
        athlete: row.athlete,
        startTime: row.startTime,
      });
    }

    const orderedRows = Object.entries(groupedByDate)
      .map(([date, athletes]) => ({
        date,
        athletes: athletes.sort((a, b) =>
          a.startTime.localeCompare(b.startTime),
        ),
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const header = [
      "Club",
      "Meet",
      "Name",
      "Weight Class",
      "Session",
      "Platform",
      "Date",
      "Start Time",
    ];
    const rows = [header];

    orderedRows.forEach((group) => {
      group.athletes.forEach(({ athlete, startTime }) => {
        const details = getSessionDetails(athlete.session?.number ?? 0);
        const dateStr = details?.date ?? "";

        rows.push([
          tempClubFilter,
          selectedMeet || "",
          athlete.name || "",
          athlete.weightClass || "",
          athlete.session?.number?.toString() || "",
          athlete.session?.platform || "",
          formatDate(dateStr),
          formatTime(startTime),
        ]);
      });
    });

    const csvContent = rows
      .map((row) => row.map((cell) => csvEscape(cell)).join(","))
      .join("\n");

    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert(
          "Sharing Unavailable",
          "Sharing is not available on this device.",
        );
        return;
      }

      const fileName = `meetcal-schedule-${sanitizeFileName(tempClubFilter)}-${Date.now()}.csv`;
      const file = new FileSystem.File(FileSystem.Paths.cache, fileName);
      file.write(csvContent, { encoding: "utf8" });

      await Sharing.shareAsync(file.uri, {
        mimeType: "text/csv",
        dialogTitle: "Share Schedule CSV",
        UTI: "public.comma-separated-values-text",
      });
    } catch (error) {
      console.error("Error generating CSV:", error);
      Alert.alert("Error", "Failed to generate CSV. Please try again.");
    }
  };

  if (loading) {
    return <StartListSkeleton skeletonPulse={skeletonPulse} />;
  }

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }]}
      key={selectedMeet}
    >
      <View
        style={[
          styles.filterContainer,
          {
            backgroundColor: colors.background,
            borderBottomColor: colors.borderBottom,
            borderBottomWidth: 1,
          },
        ]}
      >
        <View style={styles.searchContainer}>
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
              placeholder="Search athletes..."
              placeholderTextColor={colors.secondaryText}
              value={searchQuery}
              onChangeText={setSearchQuery}
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
        <View style={styles.buttonRow}>
          <Pressable
            style={({ pressed }) => [
              styles.button,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={handleOpenModal}
          >
            <ThemedText
              style={[styles.buttonText, { color: colors.secondaryText }]}
            >
              {getFilterDisplayText()}
            </ThemedText>
            <IconSymbol
              name={getChevronIcon("down")}
              size={12}
              color={colors.secondaryText}
            />
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.saveButton,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={() => setShowSaveModal(true)}
          >
            <IconSymbol
              name={getSaveIcon()}
              size={16}
              color={colors.secondaryText}
            />
          </Pressable>
        </View>
      </View>

      <ExpandedIdProvider>
        <FlashList
          data={filteredAthletes}
          keyExtractor={keyExtractor}
          renderItem={renderListItem}
          removeClippedSubviews={true}
          drawDistance={350}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: 80 + insets.bottom },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.text}
            />
          }
        />
      </ExpandedIdProvider>

      <Modal
        visible={showFilterModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          setExpandedSection(null);
          setShowFilterModal(false);
        }}
      >
        <Pressable
          style={[
            styles.modalOverlay,
            { backgroundColor: colors.modalBackground },
          ]}
          onPress={() => {
            setExpandedSection(null);
            setShowFilterModal(false);
          }}
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
                          setTempWeightClassFilter(""); // Clear weight class when age group changes
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
                            setTempWeightClassFilter(""); // Clear weight class when age group changes
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
                          setTempWeightClassFilter(""); // Clear weight class when gender changes
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
                          setTempWeightClassFilter(""); // Clear weight class when gender changes
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
                          setTempWeightClassFilter(""); // Clear weight class when gender changes
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
                          setTempWeightClassFilter(""); // Clear weight class when adaptive filter changes
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
                          setTempWeightClassFilter(""); // Clear weight class when adaptive filter changes
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
                          setTempWeightClassFilter(""); // Clear weight class when adaptive filter changes
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
                                  toggleStarredClub(club);
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
                    {tempFilteredAthleteCount}
{' '}
athletes
</ThemedText>
                  <Pressable
                    style={({ pressed }) => [
                      styles.resetButton,
                      pressed && { opacity: 0.8 },
                    ]}
                    onPress={resetFilters}
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
                    onPress={handleApplyFilters}
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

      <Modal
        visible={showSaveModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowSaveModal(false)}
      >
        <Pressable
          style={[
            styles.modalOverlay,
            { backgroundColor: colors.modalBackground },
          ]}
          onPress={() => setShowSaveModal(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View
              style={[
                styles.saveModalHeader,
                { borderBottomColor: colors.border },
              ]}
            >
              <ThemedText
                style={[styles.saveModalTitle, { color: colors.text }]}
              >
                Save 
{' '}
{filteredAthletes.length}
{' '}
Athletes
</ThemedText>
              <Pressable
                style={({ pressed }) => [
                  styles.closeButton,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => setShowSaveModal(false)}
              >
                <IconSymbol
                  name={getCloseIcon()}
                  size={20}
                  color={colors.secondaryText}
                />
              </Pressable>
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.saveOption,
                { borderBottomColor: colors.border },
                pressed && { backgroundColor: colors.pressed },
              ]}
              onPress={() => {
                setShowSaveModal(false);
                handleSaveAll();
              }}
            >
              <View style={styles.saveOptionContent}>
                <IconSymbol name="bookmark" size={22} color={colors.text} />
                <View style={styles.saveOptionText}>
                  <ThemedText
                    style={[styles.saveOptionTitle, { color: colors.text }]}
                  >
                    Add to Saved
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.saveOptionSubtitle,
                      { color: colors.secondaryText },
                    ]}
                  >
                    Save sessions to your list
                  </ThemedText>
                </View>
              </View>
              <IconSymbol
                name={getChevronIcon("right")}
                size={16}
                color={colors.secondaryText}
              />
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.saveOption,
                { borderBottomColor: colors.border },
                pressed && { backgroundColor: colors.pressed },
              ]}
              onPress={() => {
                setShowSaveModal(false);
                handleSaveToCalendar();
              }}
            >
              <View style={styles.saveOptionContent}>
                <IconSymbol
                  name="calendar"
                  size={22}
                  color={!isSubscribed ? colors.secondaryText : colors.text}
                />
                <View style={styles.saveOptionText}>
                  <ThemedText
                    style={[
                      styles.saveOptionTitle,
                      {
                        color: !isSubscribed
                          ? colors.secondaryText
                          : colors.text,
                      },
                    ]}
                  >
                    Add to Calendar
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.saveOptionSubtitle,
                      { color: colors.secondaryText },
                    ]}
                  >
                    Save sessions to your calendar
                  </ThemedText>
                </View>
              </View>
              <IconSymbol
                name={getChevronIcon("right")}
                size={16}
                color={colors.secondaryText}
              />
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.saveOption,
                { borderBottomColor: colors.border },
                pressed && { backgroundColor: colors.pressed },
              ]}
              onPress={() => {
                setShowSaveModal(false);
                // 1. Check auth
                const authResult = requireAuth({
                  feature: "share-schedule-image",
                  message: "Sign in to share schedule images.",
                  returnPath: "/(tabs)/(start-list)",
                });
                if (authResult === null || authResult === false) {
                  return;
                }
                // 2. Check subscription
                if (isSubscribed) {
                  captureScheduleImage();
                } else {
                  router.push({
                    pathname: "/shared-screens/paywall",
                    params: {
                      from: "/(tabs)/(start-list)",
                      feature: "share-schedule-image",
                    },
                  } as any);
                }
              }}
            >
              <View style={styles.saveOptionContent}>
                <IconSymbol
                  name={
                    Platform.select({
                      ios: "photo",
                      android: "image",
                    }) || "photo"
                  }
                  size={22}
                  color={!isSubscribed ? colors.secondaryText : colors.text}
                />
                <View style={styles.saveOptionText}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <ThemedText
                      style={[
                        styles.saveOptionTitle,
                        {
                          color: !isSubscribed
                            ? colors.secondaryText
                            : colors.text,
                        },
                      ]}
                    >
                      Create Shareable Schedule
                    </ThemedText>
                    {!isSubscribed && (
                      <IconSymbol
                        name={
                          Platform.select({
                            ios: "lock.fill",
                            android: "lock",
                          }) || "lock.fill"
                        }
                        size={14}
                        color={colors.secondaryText}
                      />
                    )}
                  </View>
                  <ThemedText
                    style={[
                      styles.saveOptionSubtitle,
                      { color: colors.secondaryText },
                    ]}
                  >
                    {isSubscribed
                      ? "Generate an image to share"
                      : "Pro feature - Upgrade to access"}
                  </ThemedText>
                </View>
              </View>
              <IconSymbol
                name={getChevronIcon("right")}
                size={16}
                color={colors.secondaryText}
              />
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.saveOption,
                { borderBottomColor: colors.border },
                pressed && { backgroundColor: colors.pressed },
              ]}
              onPress={() => {
                setShowSaveModal(false);
                // 1. Check auth
                const authResult = requireAuth({
                  feature: "export-csv",
                  message: "Sign in to export schedules.",
                  returnPath: "/(tabs)/(start-list)",
                });
                if (authResult === null || authResult === false) {
                  return;
                }
                // 2. Check subscription
                if (isSubscribed) {
                  generateShareableScheduleCsv();
                } else {
                  router.push({
                    pathname: "/shared-screens/paywall",
                    params: {
                      from: "/(tabs)/(start-list)",
                      feature: "export-csv",
                    },
                  } as any);
                }
              }}
            >
              <View style={styles.saveOptionContent}>
                <IconSymbol
                  name={
                    Platform.select({
                      ios: "square.and.arrow.down",
                      android: "download",
                    }) || "square.and.arrow.down"
                  }
                  size={22}
                  color={!isSubscribed ? colors.secondaryText : colors.text}
                />
                <View style={styles.saveOptionText}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <ThemedText
                      style={[
                        styles.saveOptionTitle,
                        {
                          color: !isSubscribed
                            ? colors.secondaryText
                            : colors.text,
                        },
                      ]}
                    >
                      Download Shareable Schedule
                    </ThemedText>
                    {!isSubscribed && (
                      <IconSymbol
                        name={
                          Platform.select({
                            ios: "lock.fill",
                            android: "lock",
                          }) || "lock.fill"
                        }
                        size={14}
                        color={colors.secondaryText}
                      />
                    )}
                  </View>
                  <ThemedText
                    style={[
                      styles.saveOptionSubtitle,
                      { color: colors.secondaryText },
                    ]}
                  >
                    {isSubscribed
                      ? "Export the schedule as a CSV file"
                      : "Pro feature - Upgrade to access"}
                  </ThemedText>
                </View>
              </View>
              <IconSymbol
                name={getChevronIcon("right")}
                size={16}
                color={colors.secondaryText}
              />
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {showShareViews && (
        <View style={{ position: "absolute", left: -10000, top: 0 }}>
          <View ref={shareScheduleRef} collapsable={false}>
            <ShareScheduleView
              filteredAthletes={filteredAthletes}
              schedule={scheduleData}
              selectedMeet={selectedMeet || ""}
              selectedClub={tempClubFilter || ""}
              getSessionDetails={getSessionDetails}
              transparentBackground={false}
            />
          </View>
          <View ref={shareScheduleTransparentRef} collapsable={false}>
            <ShareScheduleView
              filteredAthletes={filteredAthletes}
              schedule={scheduleData}
              selectedMeet={selectedMeet || ""}
              selectedClub={tempClubFilter || ""}
              getSessionDetails={getSessionDetails}
              transparentBackground={true}
            />
          </View>
        </View>
      )}

      {/* Image Preview Modal */}
      <ImagePreviewModal
        visible={showImagePreview}
        whiteImageUri={generatedImageWhiteUri}
        transparentImageUri={generatedImageTransparentUri}
        selectedIndex={selectedImageIndex}
        onChangeIndex={setSelectedImageIndex}
        onClose={() => {
          setShowImagePreview(false);
          setGeneratedImageWhiteUri(null);
          setGeneratedImageTransparentUri(null);
          setShowShareViews(false);
        }}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 12,
  },
  filterContainer: {
    padding: 16,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 16,
    marginTop: 6,
  },
  button: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    elevation: 1,
  },
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    elevation: 1,
    minWidth: 44, // Minimum touch target size
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
  },
  modalContent: {
    borderRadius: 12,
    overflow: "hidden",
    marginHorizontal: 16,
    maxHeight: "80%", // Fallback if windowHeight not available
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
  searchContainer: {
    marginBottom: 6,
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
    padding: 0, // Remove default padding on iOS
    height: 24, // Match the height of other buttons
    marginRight: 8, // Add space for the clear button
  },
  modalScrollContent: {
    flexGrow: 1,
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
  saveModalHeader: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    position: "relative",
  },
  closeButton: {
    position: "absolute",
    right: 16,
    top: 16,
    padding: 4,
    zIndex: 1,
  },
  saveModalTitle: {
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  saveOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  saveOptionContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  saveOptionText: {
    gap: 4,
  },
  saveOptionTitle: {
    fontSize: 17,
    fontWeight: "400",
  },
  saveOptionSubtitle: {
    fontSize: 13,
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
  filterOptionContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
