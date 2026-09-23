import { useRef, useCallback, useEffect, useState, RefObject } from "react";
import {
  FlatListInstance,
  ListViewToken,
  NativeScrollEvent,
  NativeSyntheticEvent,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DaySchedule, Schedule } from "@/types/schedule";

interface UsePaginatedScheduleParams {
  schedule: Schedule;
  onTitleChange: (title: string) => void;
  formatDayTitle: (day: DaySchedule) => string;
}

interface UsePaginatedScheduleReturn {
  currentPage: number;
  /** Width of one day page: the window minus the horizontal safe-area band. */
  pageWidth: number;
  flatListRef: RefObject<FlatListInstance | null>;
  handlePageChange: (index: number) => void;
  onViewableItemsChanged: (info: {
    viewableItems: ListViewToken[];
    changed: ListViewToken[];
  }) => void;
  onMomentumScrollEnd: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  viewabilityConfig: { itemVisiblePercentThreshold: number };
}

export function usePaginatedSchedule({
  schedule,
  onTitleChange,
  formatDayTitle,
}: UsePaginatedScheduleParams): UsePaginatedScheduleReturn {
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // The screen container is padded by the horizontal safe-area insets, so a
  // page is narrower than the window on devices that reserve a side band
  // (iPhone Duo). Paging off the raw window width lands between days.
  const pageWidth = Math.max(1, windowWidth - insets.left - insets.right);
  const lastPage = Math.max(0, schedule.length - 1);
  const [currentPage, setCurrentPage] = useState(0);
  const flatListRef = useRef<FlatListInstance>(null);
  const previousHeaderTitleRef = useRef<string>("");

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  const onViewableItemsChanged = useCallback(
    ({
      viewableItems,
    }: {
      viewableItems: ListViewToken[];
      changed: ListViewToken[];
    }) => {
      if (viewableItems.length > 0) {
        const [first] = viewableItems;
        // Keep `currentPage` honest even when the user never swiped: the list
        // can open on `initialScrollIndex` (today's day), and the re-anchor
        // effect below would otherwise snap back to day 0 on the first fold.
        if (typeof first.index === "number" && first.index >= 0 && first.index <= lastPage) {
          setCurrentPage(first.index);
        }
        const currentItem = first.item as DaySchedule;
        const formattedTitle = formatDayTitle(currentItem);
        if (previousHeaderTitleRef.current === formattedTitle) return;
        previousHeaderTitleRef.current = formattedTitle;
        onTitleChange(formattedTitle);
      }
    },
    [formatDayTitle, onTitleChange, lastPage],
  );

  const handlePageChange = useCallback(
    (index: number) => {
      if (
        !Number.isInteger(index) || index < 0 || index > lastPage ||
        schedule.length === 0 || index === currentPage
      ) return;
      setCurrentPage(index);
      flatListRef.current?.scrollToIndex({ index, animated: true });
    },
    [currentPage, lastPage, schedule.length],
  );

  // Refreshing a schedule can remove days while the user is on its final
  // page. Keep later width changes from re-anchoring beyond the new data.
  useEffect(() => {
    if (currentPage <= lastPage) return;
    setCurrentPage(lastPage);
    flatListRef.current?.scrollToOffset({
      offset: lastPage * pageWidth,
      animated: false,
    });
  }, [currentPage, lastPage, pageWidth]);

  // Folding/unfolding (iPhone Duo) or entering Split View changes the page
  // width and leaves the horizontal offset pointing between pages. Re-anchor
  // on the page the user was already reading whenever it changes.
  const lastPageWidthRef = useRef(pageWidth);
  useEffect(() => {
    if (lastPageWidthRef.current === pageWidth) return;
    lastPageWidthRef.current = pageWidth;
    flatListRef.current?.scrollToOffset({
      offset: Math.min(currentPage, lastPage) * pageWidth,
      animated: false,
    });
  }, [pageWidth, currentPage, lastPage]);

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset = event.nativeEvent.contentOffset.x;
      if (!Number.isFinite(offset)) return;
      const newPage = Math.max(0, Math.min(lastPage, Math.round(offset / pageWidth)));
      if (newPage !== currentPage) {
        setCurrentPage(newPage);
      }
    },
    [currentPage, pageWidth, lastPage],
  );

  return {
    currentPage,
    pageWidth,
    flatListRef,
    handlePageChange,
    onViewableItemsChanged,
    onMomentumScrollEnd,
    viewabilityConfig,
  };
}
