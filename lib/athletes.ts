import type { LiftResult } from '@/data/types/athletes';

/**
 * Shared athlete/session primitives.
 *
 * These four helpers were previously copy-pasted across `lib/attempt-estimator`,
 * `lib/database/offline-store`, `lib/database/meet-manager`,
 * `components/schedule-details/athleteBests`, `hooks/useMeetAthletes` and the
 * attempt-estimator screen. Keeping one copy means a cache key written by
 * `offline-store` and the lookup done by a screen can never drift apart.
 *
 * Types only at import time, so this module is safe to import from anywhere
 * (including `lib/database/*`) without creating a cycle.
 */

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
