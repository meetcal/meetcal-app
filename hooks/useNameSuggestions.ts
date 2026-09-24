import { useCallback, useEffect, useRef, useState } from "react";

/** Athlete names are long; shorter prefixes match too much of the federation. */
export const MIN_SUGGESTION_QUERY_LENGTH = 4;

/** How long typing has to pause before a suggestion request goes out. */
export const SUGGESTION_DEBOUNCE_MS = 350;

/** Suggestions render in a dropdown over the input, so the list is capped. */
export const MAX_NAME_SUGGESTIONS = 8;

/** Names containing every word of the query, capped for the dropdown. */
export function filterNameSuggestions(names: readonly string[], query: string): string[] {
  const words = query.trim().toLowerCase().split(/\s+/);
  return names
    .filter((name) => {
      const lower = name.toLowerCase();
      return words.every((word) => lower.includes(word));
    })
    .slice(0, MAX_NAME_SUGGESTIONS);
}

/**
 * Debounced name suggestions for a search box.
 *
 * Only the newest query may paint. The debounce bounds how many requests go
 * out, not the order they come back in: on a slow link the answer for "john"
 * could land after the one for "john smi", or after a suggestion was picked
 * or the search submitted, and reopen the dropdown with stale names. Every
 * keystroke and `dismiss` supersedes whatever is pending or in flight.
 *
 * @param fetchNames Must be stable (a module-level function).
 */
export function useNameSuggestions(fetchNames: (query: string) => Promise<string[]>) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const versionRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const supersede = useCallback(() => {
    versionRef.current += 1;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => supersede, [supersede]);

  /** Closes the dropdown and drops any pending or in-flight lookup. */
  const dismissSuggestions = useCallback(() => {
    supersede();
    setSuggestions([]);
    setLoadingSuggestions(false);
  }, [supersede]);

  /**
   * Opens the dropdown on names the caller already has (a search that matched
   * several athletes), dropping any pending or in-flight lookup.
   */
  const presentSuggestions = useCallback(
    (names: readonly string[]) => {
      supersede();
      setSuggestions(names.slice(0, MAX_NAME_SUGGESTIONS));
      setLoadingSuggestions(false);
    },
    [supersede],
  );

  const onQueryChange = useCallback(
    (text: string) => {
      supersede();
      const query = text.trim();
      if (query.length < MIN_SUGGESTION_QUERY_LENGTH) {
        setSuggestions([]);
        setLoadingSuggestions(false);
        return;
      }
      const version = versionRef.current;
      timerRef.current = setTimeout(async () => {
        timerRef.current = null;
        setLoadingSuggestions(true);
        try {
          const names = await fetchNames(query);
          if (version !== versionRef.current) return;
          setSuggestions(filterNameSuggestions(names, query));
        } catch {
          if (version !== versionRef.current) return;
          setSuggestions([]);
        } finally {
          if (version === versionRef.current) setLoadingSuggestions(false);
        }
      }, SUGGESTION_DEBOUNCE_MS);
    },
    [fetchNames, supersede],
  );

  return {
    suggestions,
    showSuggestions: suggestions.length > 0,
    loadingSuggestions,
    onQueryChange,
    dismissSuggestions,
    presentSuggestions,
  };
}
