import type { LiftResult } from '@/data/types/athletes';

/**
 * Shared athlete/session primitives.
 *
 * These four helpers were previously copy-pasted across `lib/attempt-estimator`,
 * `lib/database/offline-store`, `lib/database/meet-manager`,
 * `lib/athlete-bests`, `hooks/useMeetAthletes` and the attempt-estimator
 * screen. Keeping one copy means a cache key written by
 * `offline-store` and the lookup done by a screen can never drift apart.
 *
 * Types only at import time, so this module is safe to import from anywhere
 * (including `lib/database/*`) without creating a cycle.
 */

const ATHLETE_PLATFORMS = new Set(['Red', 'White', 'Blue', 'Stars', 'Stripes', 'Rogue']);
const OPTIONAL_SESSION_FIELDS = ['date', 'startTime', 'weighInTime', 'displayDate'];

/** Runtime boundary for persisted/API-mapped athlete rows. */
export function isLiftResult(value: unknown): value is LiftResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (
    typeof row.memberId !== 'string' ||
    typeof row.name !== 'string' || row.name.trim().length === 0 ||
    typeof row.age !== 'number' || !Number.isFinite(row.age) ||
    typeof row.club !== 'string' ||
    (row.wso !== undefined && typeof row.wso !== 'string') ||
    typeof row.gender !== 'string' ||
    typeof row.weightClass !== 'string' ||
    typeof row.entryTotal !== 'number' || !Number.isFinite(row.entryTotal) ||
    typeof row.adaptive !== 'boolean'
  ) return false;
  if (row.session === undefined) return true;
  if (!row.session || typeof row.session !== 'object' || Array.isArray(row.session)) return false;
  const session = row.session as Record<string, unknown>;
  return (
    typeof session.number === 'number' && Number.isInteger(session.number) && session.number > 0 &&
    typeof session.platform === 'string' &&
    ATHLETE_PLATFORMS.has(session.platform) &&
    OPTIONAL_SESSION_FIELDS.every(
      (field) => session[field] === undefined || typeof session[field] === 'string',
    )
  );
}

/**
 * Canonical form of an athlete name used for cache keys and cross-source
 * matching: trimmed, lowercased, inner whitespace collapsed.
 */
export function normalizeAthleteName(name: string | null | undefined): string {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Canonical form of a platform name used for cache keys and comparisons. */
export function normalizePlatformKey(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

/** The athletes lifting on one session number + platform. */
export function filterSessionAthletes(
  athletes: LiftResult[],
  sessionNumber: number,
  platform: string,
): LiftResult[] {
  const normalizedPlatform = normalizePlatformKey(platform);
  return athletes.filter((athlete) => {
    const athleteSession = athlete.session;
    if (!athleteSession) return false;
    if (athleteSession.number !== sessionNumber) return false;
    return normalizePlatformKey(athleteSession.platform) === normalizedPlatform;
  });
}

/**
 * Heaviest made attempt, or null when every attempt was missed/absent.
 * Misses are stored as negative kilos, so only positive values count.
 */
export function maxSuccessfulAttempt(
  attempts: (number | null | undefined)[],
): number | null {
  const successful = attempts.filter(
    (attempt): attempt is number => typeof attempt === 'number' && attempt > 0,
  );
  if (successful.length === 0) return null;
  return Math.max(...successful);
}

/**
 * Attempt-sheet convention, shared by every "make rate" in the app.
 *
 * Attempts are stored as kilos: positive when the lift was made, negative when
 * it was missed, and `null`/`0` when it was never taken (bombed out early,
 * declined, or simply absent from the row). So an attempt counts towards a
 * denominator whenever it is a non-zero number, and towards a numerator only
 * when it is positive.
 */
export function wasAttemptTaken(
  attempt: number | null | undefined,
): attempt is number {
  return typeof attempt === 'number' && attempt !== 0;
}

/** True only for a taken attempt that was made. See {@link wasAttemptTaken}. */
export function wasAttemptMade(
  attempt: number | null | undefined,
): attempt is number {
  return typeof attempt === 'number' && attempt > 0;
}
