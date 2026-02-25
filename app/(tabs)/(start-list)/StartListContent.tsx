import ImagePreviewModal from "@/components/share/ImagePreviewModal";
import ShareScheduleView from "@/components/share/ShareScheduleView";
import ActionModal from "@/components/start-list/ActionModal";
import {
  AthleteItem,
} from "@/components/start-list/AthleteItem";
import { StartListSkeleton } from "@/components/start-list/StartListSkeleton";
import StartListFilterModal from "@/components/ui/filters/StartListFilterModal";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
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
  saveMeetAthletes,
  saveMeetSchedule,
} from "@/lib/database/offline-store";
import { fetchAthletes, fetchSchedule } from "@/lib/database/queries";
import { isNetworkAvailable } from "@/lib/networkUtils";
import { preloadYearBests } from "@/lib/start-list-api";
import {
  getAgeCategory,
  getChevronIcon,
  compareStartTimes,
  getSaveIcon,
  isMeetName,
  parseWeightClasses,
  requestCalendarPermissions,
  sortAthletes,
  STARRED_CLUBS_FILTER,
} from "@/lib/start-list-utils";
import type { Schedule as ScheduleType } from "@/types/schedule";
import { SessionDetails } from "@/types/start-list";
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

export default function StartListScreen() {
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [weightClassFilter, setWeightClassFilter] = useState("");
  const [clubFilter, setClubFilter] = useState("");
  const [ageGroupFilter, setAgeGroupFilter] = useState("");
  const [adaptiveAthleteFilter, setAdaptiveAthleteFilter] = useState("");
  const [genderFilter, setGenderFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
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
    const cachedMeetData = await getMeetData(meet).catch(() => null);
    return {
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

  // Update apply handler
  const handleApplyFilters = (filters: {
    weightClass: string;
    club: string;
    ageGroup: string;
    adaptiveAthlete: string;
    gender: string;
  }) => {
    setWeightClassFilter(filters.weightClass);
    setClubFilter(filters.club);
    setAgeGroupFilter(filters.ageGroup);
    setAdaptiveAthleteFilter(filters.adaptiveAthlete);
    setGenderFilter(filters.gender);

    const nextCount = filterApplyCount + 1;
    setFilterApplyCount(nextCount);
    AsyncStorage.setItem(REVIEW_COUNT_KEY, String(nextCount)).catch((error) => {
      console.warn("StartList: Failed to persist filter apply count", error);
    });
    requestReviewIfEligible(nextCount);
  };

  // Add resetFilters function before the return statement
  const resetFilters = () => {
    setWeightClassFilter("");
    setClubFilter("");
    setAgeGroupFilter("");
    setAdaptiveAthleteFilter("");
    setGenderFilter("");
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
    // Validate that a specific club is selected
    if (
      !clubFilter ||
      clubFilter === "" ||
      clubFilter === STARRED_CLUBS_FILTER
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
    if (
      !clubFilter ||
      clubFilter === "" ||
      clubFilter === STARRED_CLUBS_FILTER
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
        athletes: athletes.sort((a, b) => {
          const timeOrder = compareStartTimes(a.startTime, b.startTime);
          if (timeOrder !== 0) return timeOrder;
          return a.athlete.name.localeCompare(b.athlete.name);
        }),
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
          clubFilter,
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

      const fileName = `meetcal-schedule-${sanitizeFileName(clubFilter)}-${Date.now()}.csv`;
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
            onPress={() => setShowFilterModal(true)}
          >
            <ThemedText
              style={[styles.buttonText, { color: colors.secondaryText }]}
              numberOfLines={1}
              ellipsizeMode="tail"
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
          extraData={{
            weightClassFilter,
            clubFilter,
            ageGroupFilter,
            adaptiveAthleteFilter,
            genderFilter,
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

      <StartListFilterModal
        visible={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        athletes={athletes}
        starredClubs={starredClubs}
        onToggleStarredClub={toggleStarredClub}
        weightClassFilter={weightClassFilter}
        clubFilter={clubFilter}
        ageGroupFilter={ageGroupFilter}
        adaptiveAthleteFilter={adaptiveAthleteFilter}
        genderFilter={genderFilter}
        onApplyFilters={handleApplyFilters}
        onResetFilters={resetFilters}
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

      {showShareViews && (
        <View style={{ position: "absolute", left: -10000, top: 0 }}>
          <View ref={shareScheduleRef} collapsable={false}>
            <ShareScheduleView
              filteredAthletes={filteredAthletes}
              schedule={scheduleData}
              selectedMeet={selectedMeet || ""}
              selectedClub={clubFilter || ""}
              getSessionDetails={getSessionDetails}
              backgroundPreset="white"
            />
          </View>
          <View ref={shareScheduleTransparentRef} collapsable={false}>
            <ShareScheduleView
              filteredAthletes={filteredAthletes}
              schedule={scheduleData}
              selectedMeet={selectedMeet || ""}
              selectedClub={clubFilter || ""}
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
    flexShrink: 1,
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
    padding: 0,
    height: 24,
    marginRight: 8,
  },
  clearButton: {
    padding: 4,
    marginRight: -4,
  },
});
