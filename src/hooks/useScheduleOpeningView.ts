import type { Meet } from "@/data/types/meet";
import { formatIsoDateTitle } from "@/utils/dateTime";
import { type RefObject, useEffect, useRef } from "react";
import type { FlatListInstance } from "react-native";

const INITIAL_SCROLL_DELAY_MS = 100;

export function useInitialScheduleScroll({
  isLoading,
  scheduleLength,
  initialScrollIndex,
  selectedMeet,
  flatListRef,
}: {
  isLoading: boolean;
  scheduleLength: number;
  initialScrollIndex: number;
  selectedMeet: string | null;
  flatListRef: RefObject<FlatListInstance | null>;
}): void {
  const lastAppliedInitialIndexRef = useRef<string>("");

  useEffect(() => {
    if (!isLoading && scheduleLength > 0 && initialScrollIndex > 0) {
      const applyKey = `${selectedMeet ?? "none"}:${scheduleLength}:${initialScrollIndex}`;
      if (lastAppliedInitialIndexRef.current === applyKey) return;
      lastAppliedInitialIndexRef.current = applyKey;
      const timer = setTimeout(() => {
        flatListRef.current?.scrollToIndex({
          index: initialScrollIndex,
          animated: false,
        });
      }, INITIAL_SCROLL_DELAY_MS);

      return () => clearTimeout(timer);
    }
  }, [isLoading, scheduleLength, initialScrollIndex, selectedMeet, flatListRef]);
}

export function useMeetStartDateTitle({
  isLoading,
  scheduleLength,
  meetDetails,
  setHeaderTitle,
}: {
  isLoading: boolean;
  scheduleLength: number;
  meetDetails: Meet | null;
  setHeaderTitle: (title: string) => void;
}): void {
  useEffect(() => {
    if (!isLoading && scheduleLength === 0 && meetDetails?.dates?.start) {
      const formattedDate = formatIsoDateTitle(meetDetails.dates.start);
      if (formattedDate) setHeaderTitle(formattedDate);
    }
  }, [isLoading, scheduleLength, meetDetails, setHeaderTitle]);
}
