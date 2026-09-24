import { KNOWN_PLATFORMS } from "@/data/types/athletes";
import { normalizePlatformKey } from "@/lib/athletes";

/** Fixed display order for the platforms the app has always known. */
export const PLATFORM_SORT_ORDER = KNOWN_PLATFORMS;

const KNOWN_RANK = new Map<string, number>(
  PLATFORM_SORT_ORDER.map((platform, index) => [normalizePlatformKey(platform), index]),
);

/**
 * Display order for platform names: the known platforms in
 * {@link PLATFORM_SORT_ORDER}, then every other platform alphabetically
 * (case-insensitive). Ties compare equal, so `Array.prototype.sort` keeps the
 * incoming order for them.
 */
export function comparePlatforms(a: string, b: string): number {
  const keyA = normalizePlatformKey(a);
  const keyB = normalizePlatformKey(b);
  const rankA = KNOWN_RANK.get(keyA);
  const rankB = KNOWN_RANK.get(keyB);
  if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
  if (rankA !== undefined) return -1;
  if (rankB !== undefined) return 1;
  return keyA.localeCompare(keyB, "en");
}

/** A sorted copy of `items` ordered by {@link comparePlatforms} on `getPlatform`. */
export function sortByPlatform<T>(
  items: readonly T[],
  getPlatform: (item: T) => string,
): T[] {
  return [...items].sort((a, b) => comparePlatforms(getPlatform(a), getPlatform(b)));
}
