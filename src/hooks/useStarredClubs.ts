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

/**
 * Applies star changes made before the stored list was read onto that list.
 * Each entry is the club's final starred state, so a club starred early that
 * was already stored stays starred instead of flipping off.
 */
export function mergePendingStars(
  stored: readonly string[],
  pending: ReadonlyMap<string, boolean>,
): string[] {
  let merged = [...stored];
  for (const [club, starred] of pending) {
    if (starred) {
      if (!merged.includes(club)) merged.push(club);
    } else {
      merged = merged.filter((c) => c !== club);
    }
  }
  return merged;
}

function persistStarredClubs(list: readonly string[]) {
  AsyncStorage.setItem(STARRED_CLUBS_KEY, JSON.stringify(list)).catch((error) => {
    console.error("Error saving starred clubs:", error);
  });
}

/** The user's starred clubs (the Start List's "Favorites" filter), persisted. */
export function useStarredClubs() {
  const [starredClubs, setStarredClubs] = useState<string[]>([]);
  // The latest list, so a toggle never builds on a stale render's copy.
  const starredRef = useRef<string[]>([]);
  // False until the stored list has been read. Writing before then would
  // replace the saved clubs with only the ones toggled so far.
  const loadedRef = useRef(false);
  // Star changes made before the read settled, in toggle order: club -> starred.
  const pendingRef = useRef(new Map<string, boolean>());

  useEffect(() => {
    let isCancelled = false;
    const settle = (stored: string[]) => {
      loadedRef.current = true;
      const pending = pendingRef.current;
      pendingRef.current = new Map();
      const merged = mergePendingStars(stored, pending);
      starredRef.current = merged;
      // Persist even after unmount: the toggles were the user's.
      if (pending.size > 0) persistStarredClubs(merged);
      if (!isCancelled) setStarredClubs(merged);
    };
    AsyncStorage.getItem(STARRED_CLUBS_KEY)
      .then((stored) => settle(parseStarredClubs(stored)))
      .catch((error) => {
        console.error("Error loading starred clubs:", error);
        // Nothing readable to merge with; keep the toggles made so far.
        settle([]);
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  /** Stars or unstars `club` and returns the new list (persisted in the background). */
  const toggleStarredClub = useCallback((club: string): string[] => {
    const current = starredRef.current;
    const starred = !current.includes(club);
    const next = starred ? [...current, club] : current.filter((c) => c !== club);
    starredRef.current = next;
    setStarredClubs(next);
    if (loadedRef.current) {
      persistStarredClubs(next);
    } else {
      // Re-insert so the map's order follows the latest toggle.
      pendingRef.current.delete(club);
      pendingRef.current.set(club, starred);
    }
    return next;
  }, []);

  return { starredClubs, toggleStarredClub };
}
