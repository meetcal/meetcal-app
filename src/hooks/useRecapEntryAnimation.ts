import { useEffect, useRef } from "react";
import { Animated } from "react-native";
import type { ClubMeetStats } from "@/types/club";

const STAGGER_MS = 80;
const SLIDE_DISTANCE = 24;

export function useRecapEntryAnimation(shownStats: ClubMeetStats | null) {
  const headerFade = useRef(new Animated.Value(0)).current;
  const statsSlide = useRef(new Animated.Value(SLIDE_DISTANCE)).current;
  const shareSlide = useRef(new Animated.Value(SLIDE_DISTANCE)).current;

  useEffect(() => {
    if (!shownStats) return;
    Animated.stagger(STAGGER_MS, [
      Animated.timing(headerFade, {
        toValue: 1,
        duration: 450,
        useNativeDriver: true,
      }),
      Animated.timing(statsSlide, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.timing(shareSlide, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();
  }, [shownStats, headerFade, statsSlide, shareSlide]);

  return { headerFade, statsSlide, shareSlide };
}
