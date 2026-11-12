import { MeetName } from '@/data/types/meet';
import { normalizeAthleteName, normalizePlatformKey } from '@/lib/athletes';

export const SCHEDULE_KEY_PREFIX = 'meetcal_schedule_';

export const ATHLETES_KEY_PREFIX = 'meetcal_athletes_';

export const SESSION_ATHLETES_KEY_PREFIX = 'meetcal_session_athletes_';

export const LIFTING_RESULTS_KEY_PREFIX = 'meetcal_lifting_results_';

export const ATHLETE_HISTORY_KEY_PREFIX = 'meetcal_athlete_history_';

export const ATHLETE_BESTS_KEY_PREFIX = 'meetcal_athlete_bests_';

export function getAthleteHistoryKey(normalizedName: string): string {
  return `${ATHLETE_HISTORY_KEY_PREFIX}${normalizedName}`;
}

export function getAthleteBestsKey(normalizedName: string): string {
  return `${ATHLETE_BESTS_KEY_PREFIX}${normalizedName}`;
}

export function legacyAthleteKeyName(name: string): string | null {
  const legacy = name.trim().toLowerCase().replace(/\s+/g, ' ');
  return legacy.length > 0 && legacy !== normalizeAthleteName(name) ? legacy : null;
}

export function getSessionAthletesKey(
  meetId: MeetName | string,
  sessionNumber: number,
  platform: string,
): string {
  return `${SESSION_ATHLETES_KEY_PREFIX}${encodeURIComponent(meetId)}:${sessionNumber}:${encodeURIComponent(normalizePlatformKey(platform))}`;
}
export const LIFTING_RESULTS_CHUNK_MARKER = '__chunk_';
