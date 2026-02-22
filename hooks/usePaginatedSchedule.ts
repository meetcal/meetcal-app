import { useRef, useCallback, useState, RefObject } from "react";
import { FlatList, ViewToken, useWindowDimensions } from "react-native";
import { DaySchedule, Schedule } from "@/types/schedule";

interface UsePaginatedScheduleParams {
  schedule: Schedule;
  onTitleChange: (title: string) => void;
  formatDayTitle: (day: DaySchedule) => string;
}

interface UsePaginatedScheduleReturn {
  currentPage: number;
  flatListRef: RefObject<FlatList | null>;
  handlePageChange: (index: number) => void;
  onViewableItemsChanged: (info: {
    viewableItems: ViewToken[];
    changed: ViewToken[];
  }) => void;
  onMomentumScrollEnd: (event: any) => void;
  viewabilityConfig: { itemVisiblePercentThreshold: number };
}

export function usePaginatedSchedule({
  schedule,
  onTitleChange,
  formatDayTitle,
}: UsePaginatedScheduleParams): UsePaginatedScheduleReturn {
  const { width } = useWindowDimensions();
  const [currentPage, setCurrentPage] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const previousHeaderTitleRef = useRef<string>("");

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  const onViewableItemsChanged = useCallback(
    ({
      viewableItems,
    }: {
      viewableItems: ViewToken[];
      changed: ViewToken[];
    }) => {
      if (viewableItems.length > 0) {
        const currentItem = viewableItems[0].item as DaySchedule;
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

  const onMomentumScrollEnd = useCallback(
    (event: any) => {
      const newPage = Math.round(event.nativeEvent.contentOffset.x / width);
      if (newPage !== currentPage) {
        setCurrentPage(newPage);
      }
    },
    [currentPage, width],
  );

  return {
    currentPage,
    flatListRef,
    handlePageChange,
    onViewableItemsChanged,
    onMomentumScrollEnd,
    viewabilityConfig,
  };
}
