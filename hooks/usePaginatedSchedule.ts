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
  const pageWidth = windowWidth - insets.left - insets.right;
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
        if (typeof first.index === "number") {
          setCurrentPage(first.index);
        }
        const currentItem = first.item as DaySchedule;
        const formattedTitle = formatDayTitle(currentItem);
        if (previousHeaderTitleRef.current === formattedTitle) return;
        previousHeaderTitleRef.current = formattedTitle;
        onTitleChange(formattedTitle);
      }
    },
    [formatDayTitle, onTitleChange],
  );

  const handlePageChange = useCallback(
    (index: number) => {
      if (index === currentPage) return;
      setCurrentPage(index);
      flatListRef.current?.scrollToIndex({ index, animated: true });
    },
    [currentPage],
  );

  // Folding/unfolding (iPhone Duo) or entering Split View changes the page
  // width and leaves the horizontal offset pointing between pages. Re-anchor
  // on the page the user was already reading whenever it changes.
  const lastPageWidthRef = useRef(pageWidth);
  useEffect(() => {
    if (lastPageWidthRef.current === pageWidth) return;
    lastPageWidthRef.current = pageWidth;
    flatListRef.current?.scrollToOffset({
      offset: currentPage * pageWidth,
      animated: false,
    });
  }, [pageWidth, currentPage]);

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const newPage = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
      if (newPage !== currentPage) {
        setCurrentPage(newPage);
      }
    },
    [currentPage, pageWidth],
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
