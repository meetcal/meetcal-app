/**
 * How much stored data a sync may remove without being told to. A source
 * that partly broke (a renamed column, a card whose wording changed, a cell
 * typed as "102 kg") looks to a sync like data that went away; past these
 * limits the sync refuses, so the run fails and alerts instead of deleting.
 * Each sync takes an `allowShrink` flag for the time a source really did
 * drop that much, after someone has checked it by hand.
 */

/** A sync may always remove MIN_SHRINK_ALLOWED items, and up to this share of what is stored. */
export const MAX_SHRINK_SHARE = 0.25;
export const MIN_SHRINK_ALLOWED = 20;

export type ShrinkLimit = { share: number; min: number };

/** Whether removing `removed` of `stored` items is more than a sync may do unasked. */
export function exceedsShrink(removed: number, stored: number, limit: ShrinkLimit = { share: MAX_SHRINK_SHARE, min: MIN_SHRINK_ALLOWED }): boolean {
  return removed > Math.max(limit.min, stored * limit.share);
}

type Lifts = { snatchRecord?: number; cjRecord?: number; totalRecord?: number };

const LIFTS = ['snatchRecord', 'cjRecord', 'totalRecord'] as const;

/** How many lifts a record has a value for. */
export function liftCount(record: Lifts): number {
  return LIFTS.filter((lift) => record[lift] !== undefined).length;
}

/** How many of a stored record's lifts the new row leaves without a value. */
export function clearedLifts(stored: Lifts, next: Lifts): number {
  return LIFTS.filter((lift) => stored[lift] !== undefined && next[lift] === undefined).length;
}
