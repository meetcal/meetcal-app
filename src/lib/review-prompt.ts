import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';

/**
 * App Store / Play review prompts: when to ask, and the one way to ask.
 *
 * Two triggers share this module: the Start List's filter applies (asked at
 * a few apply counts) and the first saved session (asked once, from session
 * details). Session details used to carry its own copy of the store-review
 * call and storage handling; both now go through `requestStoreReview`.
 *
 * The filter-apply policy lived inline in the Start List screen, where the
 * persisted "already prompted" list was `JSON.parse`d and kept as-is whenever
 * it was an array (strings, nulls and all, then written back on the next
 * prompt), and one corrupt value threw away the other: a bad prompted list
 * reset the apply count to 0.
 */

export const REVIEW_COUNT_KEY = 'startListFilterApplyCount';
export const REVIEW_PROMPTED_KEY = 'startListReviewPromptedCounts';
/** Filter-apply counts at which the store review sheet may be requested. */
export const REVIEW_COUNTS: readonly number[] = [5, 50, 100];

/** Set once the user has saved a session (first-save prompt). */
export const FIRST_SAVE_KEY = 'hasSavedBefore';
/** Set once the first-save prompt has been shown. */
export const FIRST_SAVE_REVIEW_SHOWN_KEY = 'hasShownReview';

export interface ReviewPromptState {
  applyCount: number;
  promptedCounts: number[];
}

function parseApplyCount(raw: string | null): number {
  if (raw == null) return 0;
  const count = Number(raw);
  return Number.isInteger(count) && count >= 0 ? count : 0;
}

function parsePromptedCounts(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is number => REVIEW_COUNTS.includes(value));
  } catch {
    return [];
  }
}

/** Reads both persisted values independently; a corrupt one never resets the other. */
export function parseReviewPromptState(
  countRaw: string | null,
  promptedRaw: string | null,
): ReviewPromptState {
  return {
    applyCount: parseApplyCount(countRaw),
    promptedCounts: parsePromptedCounts(promptedRaw),
  };
}

export function shouldRequestReview(
  applyCount: number,
  promptedCounts: readonly number[],
): boolean {
  return REVIEW_COUNTS.includes(applyCount) && !promptedCounts.includes(applyCount);
}

/** The persisted filter-apply prompt state. */
export async function loadReviewPromptState(): Promise<ReviewPromptState> {
  const [countRaw, promptedRaw] = await Promise.all([
    AsyncStorage.getItem(REVIEW_COUNT_KEY),
    AsyncStorage.getItem(REVIEW_PROMPTED_KEY),
  ]);
  return parseReviewPromptState(countRaw, promptedRaw);
}

/**
 * Asks the OS for its review sheet. Resolves `true` when the request was
 * made (the OS still decides whether to show it), `false` when the native
 * module or the store is unavailable or the request failed. Never rejects.
 */
export async function requestStoreReview(): Promise<boolean> {
  try {
    if (!(await StoreReview.isAvailableAsync())) return false;
    await StoreReview.requestReview();
    return true;
  } catch (error) {
    console.warn('Store review request failed', error);
    return false;
  }
}

export function shouldRequestFirstSaveReview(
  savedBeforeRaw: string | null,
  shownRaw: string | null,
): boolean {
  return !savedBeforeRaw && !shownRaw;
}

/** After a session save: asks for a review the first time the user saves one. */
export async function requestReviewAfterFirstSave(): Promise<void> {
  try {
    const [savedBefore, shown] = await Promise.all([
      AsyncStorage.getItem(FIRST_SAVE_KEY),
      AsyncStorage.getItem(FIRST_SAVE_REVIEW_SHOWN_KEY),
    ]);
    if (!shouldRequestFirstSaveReview(savedBefore, shown)) return;
    await AsyncStorage.setItem(FIRST_SAVE_KEY, 'true');
    if (await requestStoreReview()) {
      await AsyncStorage.setItem(FIRST_SAVE_REVIEW_SHOWN_KEY, 'true');
    }
  } catch (error) {
    console.error('Error checking review status:', error);
  }
}
