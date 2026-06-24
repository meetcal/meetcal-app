import { CalendarDestinationPickerModal } from "@/components/calendar/CalendarDestinationPickerModal";
import ImagePreviewModal from "@/components/share/ImagePreviewModal";
import ShareScheduleView from "@/components/share/ShareScheduleView";
import ActionModal from "@/components/start-list/ActionModal";
import {
  AthleteItem,
} from "@/components/start-list/AthleteItem";
import { StartListSkeleton } from "@/components/start-list/StartListSkeleton";
import {
  ClubFilterModal,
  FilterPillBar,
  type PillFilterConfig,
} from "@/components/ui/filters";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedView } from "@/components/ui/ThemedView";
import { ExpandedIdProvider } from "@/contexts/ExpandedIdContext";
import { useSavedSessions } from "@/contexts/SavedSessionsContext";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { LiftResult } from "@/data/types/athletes";
import { MeetName } from "@/data/types/meet";
import { useAppColors } from "@/hooks/useAppColors";
import {
  getMeetData,
  getMeetSchedule,
  saveMeetAthletes,
  saveMeetSchedule,
} from "@/lib/database/offline-store";
import { fetchAthletesWithSession, fetchSchedule } from "@/lib/database/queries";
import { isNetworkAvailable } from "@/lib/networkUtils";
import { getLastYearBestsBatch, preloadYearBests, type YearBests } from "@/lib/start-list-api";
import {
  compareStartTimes,
  getAgeCategory,
  getSaveIcon,
  isMeetName,
  parseWeightClasses,
  requestCalendarPermissions,
  sortAthletes,
  sortWeightClasses,
  STARRED_CLUBS_FILTER,
} from "@/lib/start-list-utils";
import type { Schedule as ScheduleType } from "@/types/schedule";
import { SessionDetails } from "@/types/start-list";
import { useAuthGuard } from "@/utils/authGuard";
import {
  type CalendarDestination,
  type CalendarSession,
  createCalendarEvents,
  createCalendarEventsToCalendar,
  getWritableCalendars,
  resolvePreferredAndroidCalendar,
  setPreferredAndroidCalendarId,
} from "@/utils/calendar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import * as FileSystem from "expo-file-system";
import { useNavigation, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Animated,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const REVIEW_COUNT_KEY = "startListFilterApplyCount";
const REVIEW_PROMPTED_KEY = "startListReviewPromptedCounts";
const REVIEW_COUNTS = [5, 50, 100] as const;

type AthleteSortOption =
  | "alphabetical"
  | "entryTotal"
  | "bestTotal"
  | "bestSnatch"
  | "bestCJ";

const AGE_GROUP_OPTIONS = [
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

const SORT_OPTIONS: { value: AthleteSortOption; label: string }[] = [
  { value: "alphabetical", label: "A-Z" },
  { value: "entryTotal", label: "Entry Total" },
  { value: "bestTotal", label: "Best Total" },
  { value: "bestSnatch", label: "Best Sn" },
  { value: "bestCJ", label: "Best CJ" },
];

export default function StartListScreen() {
  const [showClubModal, setShowClubModal] = useState(false);
  const [weightClassFilter, setWeightClassFilter] = useState("");
  const [clubFilter, setClubFilter] = useState("");
  const [ageGroupFilter, setAgeGroupFilter] = useState("");
  const [adaptiveAthleteFilter, setAdaptiveAthleteFilter] = useState("");
  const [genderFilter, setGenderFilter] = useState("");
  const [wsoFilter, setWsoFilter] = useState("");
  const [sortOption, setSortOption] = useState<AthleteSortOption>("alphabetical");
  const [searchQuery, setSearchQuery] = useState("");
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const { saveSessionsFromAthletes } = useSavedSessions();
  const [starredClubs, setStarredClubs] = useState<string[]>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showCalendarPicker, setShowCalendarPicker] = useState(false);
  const { selectedMeet } = useSelectedMeet();
  const { isSubscribed } = useSubscription();
  const { requireAuth } = useAuthGuard();
  const [loading, setLoading] = useState(true);
  const [athletes, setAthletes] = useState<LiftResult[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [scheduleData, setScheduleData] = useState<ScheduleType>([]);
  const loadInFlightRef = useRef<Promise<void> | null>(null);
  const latestLoadIdRef = useRef(0);
  const loadStartedAtRef = useRef(performance.now());
  const loggedReadyRef = useRef(false);
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
  const [athleteBests, setAthleteBests] = useState<Record<string, YearBests>>({});
  const [calendarDestinations, setCalendarDestinations] = useState<
    CalendarDestination[]
  >([]);
  const [pendingCalendarSessions, setPendingCalendarSessions] = useState<
    CalendarSession[] | null
  >(null);
  const [isCalendarPickerLoading, setIsCalendarPickerLoading] = useState(false);
  const skeletonPulse = useRef(new Animated.Value(0.4)).current;
  const listRef = useRef<FlashListRef<LiftResult>>(null);

  const handleItemExpand = useCallback((index: number) => {
    setTimeout(() => {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.1 });
    }, 100);
  }, []);

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
      if (!REVIEW_COUNTS.includes(nextCount as 5 | 50 | 100)) return;
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
    const [cachedMeetData, cachedSchedule] = await Promise.all([
      getMeetData(meet).catch(() => null),
      getMeetSchedule(meet).catch(() => []),
    ]);
    return {
      cachedAthletes: cachedMeetData?.athletes ?? [],
      cachedSchedule,
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
      if (!forceRefresh) {
        loadStartedAtRef.current = performance.now();
        loggedReadyRef.current = false;
        setLoading(true);
      }

      const requestPromise = (async () => {
        const snapshot = await loadMeetSnapshot(validMeet);

        if (!forceRefresh) {
          setAthletes(snapshot.cachedAthletes);
          setScheduleData(snapshot.cachedSchedule);
          setLoading(false);
        }

        const hasNetwork = await isNetworkAvailable();
        if (!hasNetwork) {
          setLoading(false);
          if (forceRefresh) {
            Alert.alert(
              "Error",
              "Failed to refresh start list data. Please try again.",
            );
            setAthletes(snapshot.cachedAthletes);
            setScheduleData(snapshot.cachedSchedule);
          }
          return;
        }

        const [athletesResult, scheduleResult] = await Promise.allSettled([
          fetchAthletesWithSession(validMeet),
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

  useEffect(() => {
    if (!__DEV__ || loggedReadyRef.current || loading || athletes.length === 0) {
      return;
    }

    loggedReadyRef.current = true;
    console.info("[perf] start list ready", {
      elapsedMs: Math.round(performance.now() - loadStartedAtRef.current),
      meet: selectedMeet,
      athleteCount: athletes.length,
      scheduleDays: scheduleData.length,
    });
  }, [athletes.length, loading, scheduleData.length, selectedMeet]);

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

  const renderListItem = useCallback(
    ({ item, index }: { item: LiftResult; index: number }) => (
      <AthleteItem
        athlete={item}
        router={router}
        getSessionDetails={getSessionDetails}
        onExpand={handleItemExpand}
        index={index}
      />
    ),
    [router, getSessionDetails, handleItemExpand],
  );

  const keyExtractor = useCallback(
    (item: LiftResult) => `${item.memberId}_${item.name}`,
    [],
  );

  const selectedShareGroup = useMemo(() => {
    if (clubFilter && clubFilter !== STARRED_CLUBS_FILTER) {
      return clubFilter;
    }
    return wsoFilter;
  }, [clubFilter, wsoFilter]);

  const hasActiveFilters = useMemo(
    () =>
      Boolean(
        weightClassFilter ||
          clubFilter ||
          ageGroupFilter ||
          adaptiveAthleteFilter ||
          genderFilter ||
          wsoFilter ||
          sortOption !== "alphabetical",
      ),
    [
      adaptiveAthleteFilter,
      ageGroupFilter,
      clubFilter,
      genderFilter,
      sortOption,
      weightClassFilter,
      wsoFilter,
    ],
  );

  const availableWeightClasses = useMemo(() => {
    const matchesAgeAndAdaptive = (athlete: LiftResult) => {
      if (ageGroupFilter && getAgeCategory(athlete.age) !== ageGroupFilter) {
        return false;
      }
      if (adaptiveAthleteFilter === "Adaptive Athletes") {
        return athlete.adaptive === true;
      }
      if (adaptiveAthleteFilter === "Non-Adaptive Athletes") {
        return athlete.adaptive === false;
      }
      return true;
    };

    // Determine the heaviest class per gender so it can be shown as "+kg".
    const maleWeightClasses = new Set<string>();
    const femaleWeightClasses = new Set<string>();
    athletes.forEach((athlete) => {
      if (!matchesAgeAndAdaptive(athlete)) return;
      parseWeightClasses(athlete.weightClass).forEach((wc) => {
        if (athlete.gender.toLowerCase() === "male") maleWeightClasses.add(wc);
        else if (athlete.gender.toLowerCase() === "female")
          femaleWeightClasses.add(wc);
      });
    });

    const getHeaviest = (set: Set<string>) => {
      const sorted = Array.from(set).sort(sortWeightClasses);
      return sorted[sorted.length - 1];
    };
    const heaviestMale = getHeaviest(maleWeightClasses);
    const heaviestFemale = getHeaviest(femaleWeightClasses);

    const weightClasses = new Set<string>();

    if (genderFilter) {
      const relevantHeaviest =
        genderFilter.toLowerCase() === "male" ? heaviestMale : heaviestFemale;
      if (relevantHeaviest) {
        weightClasses.add(`${relevantHeaviest.replace(/\+?kg$/, "")}+kg`);
      }
    } else {
      [heaviestMale, heaviestFemale].forEach((wc) => {
        if (wc) weightClasses.add(`${wc.replace(/\+?kg$/, "")}+kg`);
      });
    }

    athletes.forEach((athlete) => {
      if (
        genderFilter &&
        athlete.gender.toLowerCase() !== genderFilter.toLowerCase()
      ) {
        return;
      }
      if (!matchesAgeAndAdaptive(athlete)) return;
      parseWeightClasses(athlete.weightClass).forEach((wc) => {
        if (wc !== heaviestMale && wc !== heaviestFemale) {
          weightClasses.add(wc);
        }
      });
    });

    return Array.from(weightClasses).sort(sortWeightClasses);
  }, [athletes, ageGroupFilter, adaptiveAthleteFilter, genderFilter]);

  const availableAgeGroups = useMemo(() => {
    const present = new Set(
      athletes.map((athlete) => getAgeCategory(athlete.age)),
    );
    return AGE_GROUP_OPTIONS.filter((ag) => present.has(ag));
  }, [athletes]);

  const hasAdaptiveAthletes = useMemo(
    () => athletes.some((athlete) => athlete.adaptive === true),
    [athletes],
  );

  const availableWsos = useMemo(
    () =>
      Array.from(
        new Set(
          athletes
            .map((athlete) => athlete.wso?.trim())
            .filter((wso): wso is string => Boolean(wso)),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [athletes],
  );

  const pillConfigs = useMemo<PillFilterConfig[]>(() => {
    const configs: PillFilterConfig[] = [
      {
        id: "sort",
        label: "Sort",
        value: sortOption === "alphabetical" ? "" : sortOption,
        options: SORT_OPTIONS.filter((opt) => opt.value !== "alphabetical"),
        allOptionLabel: "A-Z",
      },
      {
        id: "gender",
        label: "Gender",
        value: genderFilter,
        options: [
          { value: "Male", label: "Male" },
          { value: "Female", label: "Female" },
        ],
        allOptionLabel: "All Genders",
      },
      {
        id: "ageGroup",
        label: "Age Group",
        value: ageGroupFilter,
        options: availableAgeGroups.map((ag) => ({
          value: ag,
          label: ag.replace("Masters ", "M"),
        })),
        allOptionLabel: "All Ages",
      },
      {
        id: "weightClass",
        label: "Weight Class",
        value: weightClassFilter,
        options: availableWeightClasses.map((wc) => ({
          value: wc,
          label: wc.replace("kg", ""),
        })),
        allOptionLabel: "All Weights",
      },
    ];

    if (hasAdaptiveAthletes) {
      configs.push({
        id: "adaptiveAthlete",
        label: "Adaptive",
        value: adaptiveAthleteFilter,
        options: [
          { value: "Adaptive Athletes", label: "Adaptive" },
          { value: "Non-Adaptive Athletes", label: "Non-Adaptive" },
        ],
        allOptionLabel: "All Athletes",
      });
    }

    // Club opens a dedicated searchable popup.
    configs.push({
      id: "club",
      label: "Club",
      value: clubFilter === STARRED_CLUBS_FILTER ? "Favorites" : clubFilter,
      options: [],
      onPress: () => setShowClubModal(true),
    });

    if (availableWsos.length > 0) {
      configs.push({
        id: "wso",
        label: "WSO",
        value: wsoFilter,
        options: availableWsos.map((wso) => ({ value: wso, label: wso })),
        allOptionLabel: "All Regions",
      });
    }

    return configs;
  }, [
    sortOption,
    genderFilter,
    ageGroupFilter,
    weightClassFilter,
    adaptiveAthleteFilter,
    clubFilter,
    wsoFilter,
    availableAgeGroups,
    availableWeightClasses,
    availableWsos,
    hasAdaptiveAthletes,
  ]);

  const trackFilterApply = useCallback(() => {
    setFilterApplyCount((prev) => {
      const nextCount = prev + 1;
      AsyncStorage.setItem(REVIEW_COUNT_KEY, String(nextCount)).catch(
        (error) => {
          console.warn(
            "StartList: Failed to persist filter apply count",
            error,
          );
        },
      );
      requestReviewIfEligible(nextCount);
      return nextCount;
    });
  }, [requestReviewIfEligible]);

  const handlePillSelect = useCallback(
    (id: string, value: string) => {
      trackFilterApply();
      switch (id) {
        case "sort":
          setSortOption((value || "alphabetical") as AthleteSortOption);
          break;
        case "gender":
          setGenderFilter(value);
          setWeightClassFilter("");
          break;
        case "ageGroup":
          setAgeGroupFilter(value);
          setWeightClassFilter("");
          break;
        case "adaptiveAthlete":
          setAdaptiveAthleteFilter(value);
          setWeightClassFilter("");
          break;
        case "weightClass":
          setWeightClassFilter(value);
          break;
        case "wso":
          setWsoFilter(value);
          break;
      }
    },
    [trackFilterApply],
  );

  const handleSelectClub = useCallback(
    (club: string) => {
      trackFilterApply();
      setClubFilter(club);
    },
    [trackFilterApply],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable
            style={styles.headerIconButton}
            onPress={() => setShowSaveModal(true)}
            accessibilityRole="button"
            accessibilityLabel="Open download options"
          >
            <IconSymbol
              name={getSaveIcon()}
              size={24}
              color={colors.text}
            />
          </Pressable>
        </View>
      ),
    });
  }, [colors.text, navigation]);

  const normalizedAthletes = useMemo(() => {
    return athletes.map((athlete) => ({
      athlete,
      nameLower: athlete.name.toLowerCase(),
      weightClasses: parseWeightClasses(athlete.weightClass),
      ageCategory: getAgeCategory(athlete.age),
      genderLower: athlete.gender.toLowerCase(),
      wso: athlete.wso?.trim() || "",
    }));
  }, [athletes]);

  useEffect(() => {
    if (
      sortOption !== "bestTotal" &&
      sortOption !== "bestSnatch" &&
      sortOption !== "bestCJ"
    ) {
      return;
    }

    if (athletes.length === 0) {
      setAthleteBests({});
      return;
    }

    let isCancelled = false;
    const loadAthleteBests = async () => {
      try {
        const uniqueNames = Array.from(
          new Set(athletes.map((athlete) => athlete.name).filter(Boolean)),
        );
        const bests = await getLastYearBestsBatch(uniqueNames);
        if (!isCancelled) {
          setAthleteBests(bests);
        }
      } catch (error) {
        if (!isCancelled) {
          console.warn("StartList: Failed to load athlete bests", error);
          setAthleteBests({});
        }
      }
    };

    loadAthleteBests();

    return () => {
      isCancelled = true;
    };
  }, [athletes, sortOption]);

  const sortFilteredAthletes = useCallback(
    (left: LiftResult, right: LiftResult) => {
      if (sortOption === "alphabetical") {
        return sortAthletes(left, right);
      }

      const compareDescending = (leftValue: number, rightValue: number) => {
        if (rightValue !== leftValue) {
          return rightValue - leftValue;
        }
        return sortAthletes(left, right);
      };

      if (sortOption === "entryTotal") {
        return compareDescending(left.entryTotal || 0, right.entryTotal || 0);
      }

      const leftBests = athleteBests[left.name];
      const rightBests = athleteBests[right.name];

      if (sortOption === "bestTotal") {
        return compareDescending(
          leftBests?.bestTotal || 0,
          rightBests?.bestTotal || 0,
        );
      }

      if (sortOption === "bestSnatch") {
        return compareDescending(
          leftBests?.bestSnatch || 0,
          rightBests?.bestSnatch || 0,
        );
      }

      return compareDescending(leftBests?.bestCJ || 0, rightBests?.bestCJ || 0);
    },
    [athleteBests, sortOption],
  );

  const filteredAthletes = useMemo(() => {
    const search = searchQuery.toLowerCase();
    const gender = genderFilter.toLowerCase();

    return normalizedAthletes
      .filter(
        ({ athlete, nameLower, weightClasses, ageCategory, genderLower, wso }) => {
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
          const matchesWSO = wsoFilter ? wso === wsoFilter : true;

          return (
            matchesWeightClass &&
            matchesClub &&
            matchesSearch &&
            matchesAgeGroup &&
            matchesAdaptiveAthlete &&
            matchesGender &&
            matchesWSO
          );
        },
      )
      .map(({ athlete }) => athlete)
      .sort(sortFilteredAthletes);
  }, [
    normalizedAthletes,
    weightClassFilter,
    clubFilter,
    searchQuery,
    ageGroupFilter,
    adaptiveAthleteFilter,
    genderFilter,
    wsoFilter,
    starredClubs,
    sortFilteredAthletes,
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
                scheduleData,
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
      router.push("/shared-screens/paywall");
      return;
    }

    if (!selectedMeet || !isMeetName(selectedMeet)) {
      Alert.alert(
        "Error",
        "Please select a meet before adding events to calendar.",
      );
      return;
    }

    // Deduplicate sessions by unique key (session number + platform only)
    // Multiple weight classes on the same platform are part of the same calendar event
    const sessionMap = new Map<string, any>();

    buildSessionExportRows().forEach((row) => {
      const sessionKey = `${row.sessionNumber}-${row.platform}`;

      if (!sessionMap.has(sessionKey)) {
        sessionMap.set(sessionKey, {
          date: row.date,
          startTime: row.startTime,
          weighInTime: row.weighInTime,
          sessionNumber: row.sessionNumber.toString(),
          platform: row.platform,
          weightClass: row.weightClass,
          meet: selectedMeet,
        });
      }
    });

    const sessionsToAdd = Array.from(sessionMap.values());

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

              if (Platform.OS === "android") {
                const preferredCalendar = await resolvePreferredAndroidCalendar();
                if (preferredCalendar) {
                  await createCalendarEventsToCalendar(
                    sessionsToAdd,
                    preferredCalendar.id,
                  );
                  Alert.alert(
                    "Success",
                    `Sessions have been added to ${preferredCalendar.title}.`,
                  );
                  return;
                }

                const writableCalendars = await getWritableCalendars();
                if (writableCalendars.length === 0) {
                  Alert.alert(
                    "No Calendars Found",
                    "Add a calendar account on this device before saving sessions.",
                  );
                  return;
                }

                setCalendarDestinations(writableCalendars);
                setPendingCalendarSessions(sessionsToAdd);
                setShowCalendarPicker(true);
                return;
              }

              await createCalendarEvents(sessionsToAdd);
              Alert.alert("Success", "Sessions have been added to your calendar.");
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

  const handleAndroidCalendarSelection = useCallback(
    async (destination: CalendarDestination) => {
      if (!pendingCalendarSessions?.length) {
        setShowCalendarPicker(false);
        return;
      }

      setIsCalendarPickerLoading(true);

      try {
        await setPreferredAndroidCalendarId(destination.id);
        await createCalendarEventsToCalendar(
          pendingCalendarSessions,
          destination.id,
        );
        setShowCalendarPicker(false);
        setPendingCalendarSessions(null);
        Alert.alert(
          "Success",
          `Sessions have been added to ${destination.title}.`,
        );
      } catch (error) {
        console.error("StartList: failed to write calendar events", error);
        Alert.alert(
          "Error",
          error instanceof Error
            ? error.message
            : "Failed to add sessions to calendar.",
        );
      } finally {
        setIsCalendarPickerLoading(false);
      }
    },
    [pendingCalendarSessions],
  );

  // Add resetFilters function before the return statement
  const resetFilters = () => {
    setWeightClassFilter("");
    setClubFilter("");
    setAgeGroupFilter("");
    setAdaptiveAthleteFilter("");
    setGenderFilter("");
    setWsoFilter("");
    setSortOption("alphabetical");
    setSearchQuery("");
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

  const handleCreateShareableSchedule = () => {
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
  };

  const handleDownloadShareableSchedule = () => {
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
  };

  // Capture schedule image for sharing
  const captureScheduleImage = async () => {
    if (!selectedShareGroup) {
      Alert.alert(
        "Select a Club or WSO",
        "Please select a specific club or WSO from the filters to create a shareable schedule.",
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

      const [whiteUri, transparentUri] = await Promise.all([
        captureRef(shareScheduleRef.current, {
          format: "png",
          quality: 1.0,
          result: "tmpfile",
          width: 850,
          height: undefined,
        }),
        captureRef(shareScheduleTransparentRef.current, {
          format: "png",
          quality: 1.0,
          result: "tmpfile",
          width: 850,
          height: undefined,
        }),
      ]);
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
    if (!selectedShareGroup) {
      Alert.alert(
        "Select a Club or WSO",
        "Please select a specific club or WSO from the filters to create a shareable schedule.",
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
        athletes: athletes.sort((a, b) => {
          const timeOrder = compareStartTimes(a.startTime, b.startTime);
          if (timeOrder !== 0) return timeOrder;
          return a.athlete.name.localeCompare(b.athlete.name);
        }),
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const header = [
      "Group",
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
          selectedShareGroup,
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

      const fileName = `meetcal-schedule-${sanitizeFileName(selectedShareGroup)}-${Date.now()}.csv`;
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
      testID="start-list-screen"
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
              testID="start-list-search"
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search athletes..."
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

        <View style={styles.pillBarContainer}>
          <FilterPillBar
            configs={pillConfigs}
            onSelect={handlePillSelect}
            hasActiveFilters={hasActiveFilters}
            onReset={resetFilters}
          />
        </View>
      </View>

      <ExpandedIdProvider>
        <FlashList
          ref={listRef}
          data={filteredAthletes}
          extraData={{
            weightClassFilter,
            clubFilter,
            ageGroupFilter,
            adaptiveAthleteFilter,
            genderFilter,
            wsoFilter,
            searchQuery,
          }}
          keyExtractor={keyExtractor}
          renderItem={renderListItem}
          removeClippedSubviews={false}
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

      <ClubFilterModal
        visible={showClubModal}
        onClose={() => setShowClubModal(false)}
        athletes={athletes}
        starredClubs={starredClubs}
        onToggleStarredClub={toggleStarredClub}
        selectedClub={clubFilter}
        onSelectClub={handleSelectClub}
      />

      <ActionModal
        visible={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        athleteCount={filteredAthletes.length}
        isSubscribed={isSubscribed}
        onSaveAll={handleSaveAll}
        onSaveToCalendar={handleSaveToCalendar}
        onCreateShareableSchedule={handleCreateShareableSchedule}
        onDownloadShareableSchedule={handleDownloadShareableSchedule}
      />

      <CalendarDestinationPickerModal
        visible={showCalendarPicker}
        title="Choose Calendar"
        destinations={calendarDestinations}
        onClose={() => {
          setShowCalendarPicker(false);
          setPendingCalendarSessions(null);
        }}
        onSelect={(destination) => {
          void handleAndroidCalendarSelection(destination);
        }}
        isLoading={isCalendarPickerLoading}
      />

      {showShareViews && (
        <View style={{ position: "absolute", left: -10000, top: 0 }}>
          <View ref={shareScheduleRef} collapsable={false}>
            <ShareScheduleView
              filteredAthletes={filteredAthletes}
              schedule={scheduleData}
              selectedMeet={selectedMeet || ""}
              selectedGroup={selectedShareGroup || ""}
              getSessionDetails={getSessionDetails}
              backgroundPreset="white"
            />
          </View>
          <View ref={shareScheduleTransparentRef} collapsable={false}>
            <ShareScheduleView
              filteredAthletes={filteredAthletes}
              schedule={scheduleData}
              selectedMeet={selectedMeet || ""}
              selectedGroup={selectedShareGroup || ""}
              getSessionDetails={getSessionDetails}
              backgroundPreset="transparent"
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
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  headerIconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  searchContainer: {
    marginBottom: 2,
  },
  pillBarContainer: {
    marginTop: 12,
    marginHorizontal: -16,
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
});
