import { UNKNOWN_PLATFORM, type LiftResult, type Platform } from '@/data/types/athletes';

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

const OPTIONAL_SESSION_FIELDS = ['date', 'startTime', 'weighInTime', 'displayDate'];

/**
 * A cached roster written within this window is taken as current, without
 * fetching it again. Opening a meet runs `prefetchCriticalMeetData`, which
 * fetches and saves the roster; the Start List then mounted and fetched it
 * again, so a single meet open cost two roster downloads (and a deferred
 * launch warm-up after a Start List fetch would do the same). The check uses
 * the roster's own write time (`MeetData.athletesSyncedAt`): `lastSyncTime`
 * is also bumped by every 5-minute schedule sync, which would make a
 * days-old roster look fresh. Well inside the 5-minute SyncManager cadence,
 * so nothing goes staler than it already could.
 */
export const FRESH_SNAPSHOT_TTL_MS = 60 * 1000;

export function isSnapshotFresh(athletesSyncedAt: number, now: number): boolean {
  return athletesSyncedAt > 0 && now - athletesSyncedAt < FRESH_SNAPSHOT_TTL_MS;
}

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
    typeof session.platform === 'string' && session.platform.trim().length > 0 &&
    OPTIONAL_SESSION_FIELDS.every(
      (field) => session[field] === undefined || typeof session[field] === 'string',
    )
  );
}

/**
 * Coerce a persisted or API-mapped athlete row into a valid `LiftResult`, or
 * `null` when it cannot be salvaged.
 *
 * Nullable source columns (`club`, `entry_total`, `member_id`, ...) are
 * defaulted rather than rejected. Rows like that were rendered before the
 * strict guard existed and are already sitting in users' offline caches, so
 * rejecting them would silently drop athletes from a downloaded start list.
 * Only rows with no usable name or a malformed session are discarded.
 */
export function normalizeLiftResult(value: unknown): LiftResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const toNumber = (field: unknown): number => {
    if (typeof field === 'number' && Number.isFinite(field)) return field;
    if (typeof field === 'string' && field.trim() !== '') {
      const parsed = Number(field);
      if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
  };
  const toText = (field: unknown): string => (typeof field === 'string' ? field : '');
  const candidate: Record<string, unknown> = {
    ...row,
    memberId: toText(row.memberId),
    age: toNumber(row.age),
    club: toText(row.club),
    gender: toText(row.gender),
    weightClass: toText(row.weightClass),
    entryTotal: toNumber(row.entryTotal),
    adaptive: row.adaptive === true,
  };
  if (typeof row.wso === 'string' && row.wso.length > 0) {
    candidate.wso = row.wso;
  } else {
    delete candidate.wso;
  }
  if (row.session === null) delete candidate.session;
  return isLiftResult(candidate) ? candidate : null;
}

/** {@link normalizeLiftResult} over a list, dropping only unsalvageable rows. */
export function normalizeLiftResults(values: readonly unknown[]): LiftResult[] {
  const athletes: LiftResult[] = [];
  for (const value of values) {
    const athlete = normalizeLiftResult(value);
    if (athlete) athletes.push(athlete);
  }
  return athletes;
}

/**
 * Canonical form of an athlete name used for cache keys and cross-source
 * matching: composed to Unicode NFC, inner whitespace collapsed, trimmed,
 * lowercased.
 *
 * The same key as the server's (`normalizeName` in `convex/lib/names.ts`):
 * `trim` strips exactly the characters `\s` matches, so trimming and folding
 * runs equals its split-and-join, without the arrays. The server matches
 * "José" written precomposed and with a combining accent as one athlete and
 * returns each row with its stored spelling, so a key that skipped NFC
 * grouped those rows apart from a roster name in the other form: the
 * athlete's history, bests and estimates came up empty. It is also the
 * offline storage key (`meetcal_athlete_history_<key>`,
 * `meetcal_athlete_bests_<key>`).
 */
export function normalizeAthleteName(name: string | null | undefined): string {
  return (name || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Equality key for a platform name: trimmed, lowercased, inner whitespace
 * collapsed. This is the one rule for deciding that two platform strings name
 * the same platform (`"RED "` ≡ `"Red"`); every session/platform match in the
 * app goes through it (or {@link isSamePlatform}).
 */
export function normalizePlatformKey(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** True when two platform strings name the same platform. */
export function isSamePlatform(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return normalizePlatformKey(a) === normalizePlatformKey(b);
}

/**
 * Display/storage form of a platform name: trimmed, inner whitespace
 * collapsed, each whitespace-separated word title-cased. Mirrors the backend
 * scrapers' `normalize_platform` (`scrapers/common/normalize.py`) word for
 * word, so the name the app sends back to the API is the name the scrapers
 * stored: `"RED "` → `"Red"`, `"gold"` → `"Gold"`,
 * `"stars & stripes"` → `"Stars & Stripes"`. Unknown names are kept, never
 * remapped to Red. A blank or missing value becomes {@link UNKNOWN_PLATFORM}.
 */
export function canonicalizePlatform(value: string | null | undefined): Platform {
  const collapsed = (value || '').trim().replace(/\s+/g, ' ');
  if (collapsed.length === 0) return UNKNOWN_PLATFORM;
  return collapsed
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
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
 * Whether a fresh roster answer replaces the athletes already shown (or
 * cached). An empty answer never does: the server briefly answers `[]` during
 * a re-import or a transient filter miss, and a session that had athletes
 * does not lose them all at once. With nothing shown, the empty answer is the
 * truth ("no athletes yet"). One rule for the Start List, the session
 * details card and the attempt estimator.
 */
export function freshRosterReplacesShown(freshCount: number, shownCount: number): boolean {
  return freshCount > 0 || shownCount === 0;
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
