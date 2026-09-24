/**
 * Store-review prompt policy for the start list's filter sheet.
 *
 * Lived inline in `StartListContent`, where the persisted "already prompted"
 * list was `JSON.parse`d and kept as-is whenever it was an array (strings,
 * nulls and all, then written back on the next prompt), and one corrupt value
 * threw away the other: a bad prompted list reset the apply count to 0.
 */

export const REVIEW_COUNT_KEY = 'startListFilterApplyCount';
export const REVIEW_PROMPTED_KEY = 'startListReviewPromptedCounts';
/** Filter-apply counts at which the store review sheet may be requested. */
export const REVIEW_COUNTS: readonly number[] = [5, 50, 100];

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
