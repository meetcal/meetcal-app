import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";

export const STARRED_CLUBS_KEY = "starredClubs";

/**
 * The persisted starred-clubs list, or `[]` for anything that is not a JSON
 * array (strings dropped). The list is consumed with `.includes` and
 * `.filter`: a blob that is not a string array made `.filter` throw
 * mid-render, and a *string* blob was worse, since `.includes` silently
 * matched substrings.
 */
export function parseStarredClubs(stored: string | null): string[] {
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((club): club is string => typeof club === "string")
      : [];
  } catch {
    return [];
  }
}

/** The user's starred clubs (the Start List's "Favorites" filter), persisted. */
export function useStarredClubs() {
  const [starredClubs, setStarredClubs] = useState<string[]>([]);
  // The latest list, so a toggle never builds on a stale render's copy.
  const starredRef = useRef<string[]>([]);

  useEffect(() => {
    let isCancelled = false;
    AsyncStorage.getItem(STARRED_CLUBS_KEY)
      .then((stored) => {
        if (isCancelled || !stored) return;
        const parsed = parseStarredClubs(stored);
        starredRef.current = parsed;
        setStarredClubs(parsed);
      })
      .catch((error) => {
        console.error("Error loading starred clubs:", error);
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  /** Stars or unstars `club` and returns the new list (persisted in the background). */
  const toggleStarredClub = useCallback((club: string): string[] => {
    const current = starredRef.current;
    const next = current.includes(club)
      ? current.filter((c) => c !== club)
      : [...current, club];
    starredRef.current = next;
    setStarredClubs(next);
    AsyncStorage.setItem(STARRED_CLUBS_KEY, JSON.stringify(next)).catch((error) => {
      console.error("Error saving starred clubs:", error);
    });
    return next;
  }, []);

  return { starredClubs, toggleStarredClub };
}
