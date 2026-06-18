import { IconSymbol } from "@/components/ui/IconSymbol";
import { useFocusEffect, useNavigation, usePathname, useRouter } from "expo-router";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  FlatList,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";

import { DayView } from "@/components/schedule/DayView";
import { MeetSelectionModal } from "@/components/schedule/MeetSelectionModal";
import {
  checkOnboardingComplete,
  OnboardingView,
} from "@/components/schedule/OnboardingView";
import { PageIndicator } from "@/components/schedule/PageIndicator";
import { ScheduleSkeleton } from "@/components/schedule/ScheduleSkeleton";
import { VersionAnnouncement } from "@/components/schedule/VersionAnnouncement";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { useAppColors } from "@/hooks/useAppColors";
import { usePaginatedSchedule } from "@/hooks/usePaginatedSchedule";
import { useScheduleData } from "@/hooks/useScheduleData";
import { useUpcomingMeets } from "@/hooks/useUpcomingMeets";
import { initStore } from "@/lib/database/offline-store";
import { formatDayTitle, getTimeZoneAbbreviation } from "@/utils/dateTime";
import { useUser } from "@clerk/expo";

export default function ScheduleScreen() {
  const { width } = useWindowDimensions();
  const navigation = useNavigation();
  const {
    selectedMeet,
    meetDetails,
    isLoading: isMeetLoading,
    setSelectedMeet,
    availableMeets,
    refreshAvailableMeets,
  } = useSelectedMeet();
  const { isLoaded: isUserLoaded, isSignedIn } = useUser();
  const router = useRouter();
  const pathname = usePathname();
  const colors = useAppColors();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [isRefreshingMeets, setIsRefreshingMeets] = useState(false);
  const [isChangingMeet, setIsChangingMeet] = useState(false);
  const lastAppliedInitialIndexRef = useRef<string>("");

  // Use custom hooks
  const {
    schedule,
    isLoading,
    isRefreshing,
    initialScrollIndex,
    refreshSchedule,
  } = useScheduleData(selectedMeet);

  const { upcomingMeets } = useUpcomingMeets({ availableMeets });

  const handleTitleChange = useCallback(
    (title: string) => {
      navigation.setOptions({ title });
    },
    [navigation],
  );

  const {
    currentPage,
    flatListRef,
    handlePageChange,
    onViewableItemsChanged,
    onMomentumScrollEnd,
    viewabilityConfig,
  } = usePaginatedSchedule({
    schedule,
    onTitleChange: handleTitleChange,
    formatDayTitle,
  });

  const timeZoneAbbreviation = useMemo(() => {
    const timeZoneId =
      meetDetails?.time.timeZoneIdentifier || "America/New_York";
    return getTimeZoneAbbreviation(timeZoneId);
  }, [meetDetails?.time.timeZoneIdentifier]);

  // Header configuration
  useLayoutEffect(() => {
    const offlineDataIcon =
      Platform.OS === "ios" ? "square.and.arrow.down" : "download";
    navigation.setOptions({
      ...(Platform.OS === "ios" && {
        headerLeft: () => (
          <Pressable
            style={styles.headerIconButton}
            onPress={() => router.push("/schedule-toolbar/offline-data")}
            accessibilityRole="button"
            accessibilityLabel="Offline data"
          >
            <IconSymbol name={offlineDataIcon} size={24} color={colors.text} />
          </Pressable>
        ),
      }),
      headerRight: () => (
        <View style={styles.headerActions}>
          {Platform.OS === "android" && (
            <Pressable
              style={styles.headerIconButton}
              onPress={() => router.push("/schedule-toolbar/offline-data")}
              accessibilityRole="button"
              accessibilityLabel="Offline data"
            >
              <IconSymbol
                name={offlineDataIcon}
                size={24}
                color={colors.text}
              />
            </Pressable>
          )}
          <Pressable
            style={[styles.headerIconButton, { paddingTop: 8 }]}
            onPress={() => {
              if (!isUserLoaded) return;
              if (isSignedIn) {
                router.push("/schedule-toolbar/profile");
              } else {
                router.push({
                  pathname: "/(auth)/sign-in",
                  params: { from: "info" },
                });
              }
            }}
            accessibilityRole="button"
            accessibilityLabel={
              isSignedIn ? "My profile and settings" : "Sign in"
            }
          >
            <IconSymbol
              name={
                Platform.OS === "ios"
                  ? "person.circle.fill"
                  : "person-circle-sharp"
              }
              size={24}
              color={colors.text}
            />
          </Pressable>
        </View>
      ),
    });
  }, [colors.text, isSignedIn, isUserLoaded, navigation, pathname, router]);

  useEffect(() => {
    initStore();
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!selectedMeet) return;
      void refreshSchedule();
    }, [refreshSchedule, selectedMeet]),
  );

  // Check onboarding status on mount
  useEffect(() => {
    let aborted = false;

    const checkOnboarding = async () => {
      try {
        const completed = await checkOnboardingComplete();
        if (!aborted && !completed) {
          setShowOnboarding(true);
        }
      } catch (error) {
        if (!aborted) {
          console.error("Error checking onboarding status:", error);
        }
      }
    };

    checkOnboarding();

    return () => {
      aborted = true;
    };
  }, []);

  // Scroll to initial position after data is loaded
  useEffect(() => {
    if (!isLoading && schedule.length > 0 && initialScrollIndex > 0) {
      const applyKey = `${selectedMeet ?? "none"}:${schedule.length}:${initialScrollIndex}`;
      if (lastAppliedInitialIndexRef.current === applyKey) return;
      lastAppliedInitialIndexRef.current = applyKey;
      // Use a small delay to ensure the FlatList is fully rendered
      const timer = setTimeout(() => {
        flatListRef.current?.scrollToIndex({
          index: initialScrollIndex,
          animated: false,
        });
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [
    isLoading,
    schedule.length,
    initialScrollIndex,
    selectedMeet,
    flatListRef,
  ]);

  // Set title to start date when there's no schedule loaded
  useEffect(() => {
    if (!isLoading && schedule.length === 0 && meetDetails?.dates?.start) {
      const startDate = new Date(meetDetails.dates.start);
      if (!Number.isNaN(startDate.getTime())) {
        const formattedDate = new Intl.DateTimeFormat("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
        }).format(startDate);
        navigation.setOptions({
          title: formattedDate,
        });
      }
    }
  }, [isLoading, schedule.length, meetDetails, navigation]);

  // Handle refreshing available meets in modal
  const handleRefreshMeets = useCallback(async () => {
    setIsRefreshingMeets(true);
    try {
      await refreshAvailableMeets();
    } catch (error) {
      console.error("Error refreshing meets:", error);
    } finally {
      setIsRefreshingMeets(false);
    }
  }, [refreshAvailableMeets]);

  // Handle meet selection
  const handleSelectMeet = useCallback(
    async (meetName: string) => {
      setShowFilterModal(false);
      if (meetName === selectedMeet) return;
      setIsChangingMeet(true);
      try {
        await setSelectedMeet(meetName);
      } catch (error) {
        console.error("Error saving selected meet:", error);
        Alert.alert("Error", "Failed to update selected meet.");
      } finally {
        setIsChangingMeet(false);
      }
    },
    [selectedMeet, setSelectedMeet],
  );

  // Render day view
  const renderDayView = useCallback(
    ({ item }: { item: any }) => (
      <View style={[styles.pageContainer, { width }]}>
        <DayView
          day={item}
          timeZone={timeZoneAbbreviation}
          meet={selectedMeet || ""}
          onRefreshComplete={refreshSchedule}
          refreshing={isRefreshing}
        />
      </View>
    ),
    [width, timeZoneAbbreviation, refreshSchedule, isRefreshing, selectedMeet],
  );

  if (isMeetLoading) {
    return <ScheduleSkeleton label="Loading meets..." />;
  }

  if (!selectedMeet || !meetDetails) {
    return (
      <ThemedView
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <View style={styles.loadingContainer}>
          <ThemedText style={[styles.loadingText, { color: colors.text }]}>
            Please select a meet to view the schedule
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  if ((isLoading && schedule.length === 0) || isChangingMeet) {
    return <ScheduleSkeleton label="Loading schedule..." />;
  }

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <OnboardingView
        visible={showOnboarding}
        onComplete={() => setShowOnboarding(false)}
      />

      <View
        style={[
          styles.filterContainer,
          {
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
            borderBottomWidth: 1,
          },
        ]}
      >
        <View style={styles.filterRow}>
          <Pressable
            style={({ pressed }) => [
              styles.filterButton,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={() => setShowFilterModal(true)}
          >
            <View style={styles.filterTextContainer}>
              <ThemedText
                style={[styles.filterButtonText, { color: colors.text }]}
              >
                Selected Meet
              </ThemedText>
              <ThemedText
                style={[styles.meetValue, { color: colors.secondaryText }]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {selectedMeet}
              </ThemedText>
            </View>
            <IconSymbol
              name="chevron.down"
              size={12}
              color={colors.secondaryText}
            />
          </Pressable>
        </View>
      </View>

      <VersionAnnouncement />

      {!schedule || schedule.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyStateContainer}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={refreshSchedule}
              tintColor={colors.text}
            />
          }
        >
          <Image
            source={require("@/assets/images/MeetCal-no-bg.png")}
            style={styles.emptyStateImage}
            resizeMode="contain"
          />
          <ThemedText
            style={[styles.emptyStateText, { color: colors.secondaryText }]}
          >
            No data has been loaded yet for this meet. Check back soon!
          </ThemedText>
        </ScrollView>
      ) : (
        <View style={styles.contentContainer}>
          <FlatList
            ref={flatListRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            data={schedule}
            keyExtractor={(item, index) =>
              item.fullDate || `${item.date}-${index}`
            }
            renderItem={renderDayView}
            initialScrollIndex={initialScrollIndex}
            getItemLayout={(data, index) => ({
              length: width,
              offset: width * index,
              index,
            })}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            onMomentumScrollEnd={onMomentumScrollEnd}
          />

          {schedule.length > 0 && (
            <PageIndicator
              count={schedule.length}
              currentPage={currentPage}
              onPageChange={handlePageChange}
            />
          )}
        </View>
      )}

      <MeetSelectionModal
        visible={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        meets={upcomingMeets}
        selectedMeet={selectedMeet}
        onSelectMeet={handleSelectMeet}
        onRefresh={handleRefreshMeets}
        isRefreshing={isRefreshingMeets}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  pageContainer: {
    flex: 1,
  },
  filterContainer: {
    padding: 16,
  },
  filterRow: {
    width: "100%",
  },
  filterButton: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
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
  filterTextContainer: {
    flex: 1,
    marginRight: 8,
  },
  filterButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  meetValue: {
    fontSize: 15,
    marginTop: 2,
  },
  emptyStateContainer: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingVertical: 24,
    gap: 16,
  },
  emptyStateText: {
    fontSize: 16,
    textAlign: "center",
    lineHeight: 22,
  },
  emptyStateImage: {
    width: 144,
    height: 144,
  },
  contentContainer: {
    flex: 1,
    position: "relative",
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    fontSize: 16,
    textAlign: "center",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerIconButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
});
