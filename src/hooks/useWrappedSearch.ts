import { useCallback, useRef, useState } from "react";
import { showToast } from "@/components/ui/Toast";
import { useIsOffline } from "@/hooks/useIsOffline";
import { useNameSuggestions } from "@/hooks/useNameSuggestions";
import { fetchWrapped } from "@/lib/api/wrapped-api";
import { searchApi } from "@/lib/api/results-api";
import { toWrappedStats } from "@/lib/wrapped-stats";
import type { WrappedStats } from "@/types/wrapped";

export type WrappedYear = {
  athleteName: string;
  stats: WrappedStats;
  yearSearched: number;
};

async function fetchNameSuggestions(query: string): Promise<string[]> {
  const { suggestions } = await searchApi(query);
  return suggestions;
}

export function useWrappedSearch() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [loading, setLoading] = useState(false);
  const [wrapped, setWrapped] = useState<WrappedYear | null>(null);
  const {
    suggestions,
    showSuggestions,
    loadingSuggestions,
    onQueryChange,
    dismissSuggestions,
    presentSuggestions,
  } = useNameSuggestions(fetchNameSuggestions);
  const [didYouMean, setDidYouMean] = useState(false);
  const [isOffline] = useIsOffline();
  const searchInFlightRef = useRef(false);
  const pickedNameRef = useRef<string | null>(null);

  const onSearchTextChange = useCallback((text: string) => {
    setSearchQuery(text);
    setDidYouMean(false);
    pickedNameRef.current = null;
    onQueryChange(text);
  }, [onQueryChange]);

  const selectSuggestion = useCallback((name: string) => {
    setSearchQuery(name);
    setDidYouMean(false);
    pickedNameRef.current = name;
    dismissSuggestions();
  }, [dismissSuggestions]);

  const searchAthlete = async () => {
    if (searchInFlightRef.current || isOffline) return;
    if (!searchQuery.trim()) {
      showToast({ type: "error", message: "Please enter an athlete name" });
      return;
    }

    searchInFlightRef.current = true;
    dismissSuggestions();
    setDidYouMean(false);
    setLoading(true);
    const year = selectedYear;
    try {
      const normalizedName = searchQuery.trim();
      const selection = await fetchWrapped(normalizedName, year, pickedNameRef.current === normalizedName);

      if (selection.kind === "none") {
        showToast({
          type: "info",
          message: `No results found for ${searchQuery} in ${year}`,
        });
        return;
      }
      if (selection.kind === "narrow") {
        showToast({
          type: "info",
          message: `Too many athletes match ${normalizedName}. Type more of the name.`,
        });
        return;
      }
      if (selection.kind === "tooManyResults") {
        showToast({
          type: "error",
          message: `${selection.name} has more ${year} results than a Wrapped can hold.`,
        });
        return;
      }
      if (selection.kind === "ambiguous") {
        presentSuggestions(selection.names);
        setDidYouMean(true);
        showToast({
          type: "info",
          message: selection.truncated
            ? `Many athletes match ${normalizedName}. Pick one, or type more of the name.`
            : `Several athletes match ${normalizedName}. Pick one.`,
        });
        return;
      }

      setWrapped({
        athleteName: selection.name,
        stats: toWrappedStats(selection.stats),
        yearSearched: year,
      });
    } catch (error) {
      console.error("Error in searchAthlete:", error);
      showToast({ type: "error", message: "An unexpected error occurred" });
    } finally {
      searchInFlightRef.current = false;
      setLoading(false);
    }
  };

  const closeWrapped = useCallback(() => setWrapped(null), []);

  return {
    searchQuery,
    onSearchTextChange,
    selectedYear,
    setSelectedYear,
    loading,
    isOffline,
    suggestions,
    showSuggestions,
    loadingSuggestions,
    didYouMean,
    selectSuggestion,
    searchAthlete,
    wrapped,
    closeWrapped,
  };
}

export type WrappedSearch = ReturnType<typeof useWrappedSearch>;
