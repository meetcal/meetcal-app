import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef } from "react";

import {
  loadReviewPromptState,
  REVIEW_COUNT_KEY,
  REVIEW_PROMPTED_KEY,
  requestStoreReview,
  shouldRequestReview,
} from "@/lib/review-prompt";

/**
 * Counts filter applies and asks for a store review at the thresholds in
 * `review-prompt.ts`. Returns the function to call once per apply.
 *
 * The counters are refs, not state: nothing renders them, and the write path
 * is a side effect (AsyncStorage + requestReview) that must run exactly once
 * per apply. It used to live inside a `setFilterApplyCount` updater, which
 * React is free to invoke more than once per update (double-counting the
 * threshold and re-prompting), and it re-rendered the whole screen for a
 * number no one displays.
 */
export function useFilterApplyReviewPrompt(): () => void {
  const applyCountRef = useRef(0);
  const promptedCountsRef = useRef<number[]>([]);

  useEffect(() => {
    let isMounted = true;
    loadReviewPromptState()
      .then((state) => {
        if (!isMounted) return;
        applyCountRef.current = state.applyCount;
        promptedCountsRef.current = state.promptedCounts;
      })
      .catch((error) => {
        console.warn("Review prompt: failed to load state", error);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  return useCallback(() => {
    const nextCount = applyCountRef.current + 1;
    applyCountRef.current = nextCount;
    AsyncStorage.setItem(REVIEW_COUNT_KEY, String(nextCount)).catch((error) => {
      console.warn("Review prompt: failed to persist filter apply count", error);
    });
    if (!shouldRequestReview(nextCount, promptedCountsRef.current)) return;
    void requestStoreReview()
      .then((requested) => {
        if (!requested) return;
        const updated = [...promptedCountsRef.current, nextCount];
        promptedCountsRef.current = updated;
        return AsyncStorage.setItem(REVIEW_PROMPTED_KEY, JSON.stringify(updated));
      })
      .catch((error) => {
        console.warn("Review prompt: failed to persist prompted counts", error);
      });
  }, []);
}
