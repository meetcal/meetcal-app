import { createMutableResource } from '@/lib/data/mutable-resource';
import { AthleteClub, ClubMeetStats } from '@/types/club';
import {
  getOfflineCache,
  OFFLINE_CACHE_KEYS,
  readBoundedCacheEntry,
  setOfflineCache,
  writeBoundedCacheEntry,
} from './offline-cache';
import { isNetworkAvailable } from '@/lib/networkUtils';
import { fetchApiClubNames, getJsonArray, getJsonObject } from '@/lib/api/meetcal-api';

/**
 * Clubs whose athlete lists stay cached for offline browsing. A list is one
 * row per athlete per meet, so a big club is tens of KB; 20 covers a coach's
 * own club and the rivals they look up.
 */
export const MAX_CACHED_CLUB_ATHLETE_LISTS = 20;

/**
 * Club + meet stat cards kept for offline browsing. A card is ten numbers
 * (~300 bytes), so 50 is a season of a club's meets for a few clubs in ~15KB.
 */
export const MAX_CACHED_CLUB_MEET_STATS = 50;

type ApiClubAthlete = {
  member_id: string;
  name: string;
  meet: string;
  club: string;
  gender?: string;
  weight_class?: string;
  entry_total?: number;
};

/**
 * `/clubs/meet-stats`. The API also sends a per-athlete `athlete_results`
 * list; no screen shows it, so it is neither mapped nor stored.
 */
type ApiClubMeetStats = {
  total_athletes: number;
  gold_medals: number;
  silver_medals: number;
  bronze_medals: number;
  total_prs: number;
  perfect_6_for_6: number;
  total_weight_lifted: number;
  snatch_make_rate?: number | null;
  cj_make_rate?: number | null;
  combined_make_rate?: number | null;
};

function getClubMeetStatsKey(club: string, meet: string): string {
  return `${club}::${meet}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

const CLUB_ATHLETE_STRING_FIELDS = ['member_id', 'name', 'meet', 'club'] as const;
const CLUB_MEET_STATS_REQUIRED_FIELDS = [
  'total_athletes',
  'gold_medals',
  'silver_medals',
  'bronze_medals',
  'total_prs',
  'perfect_6_for_6',
  'total_weight_lifted',
] as const;
const CLUB_MEET_STATS_OPTIONAL_FIELDS = [
  'snatch_make_rate',
  'cj_make_rate',
  'combined_make_rate',
] as const;

/**
 * One `/clubs/athletes` row with every field a screen dereferences, or null.
 * These two endpoints were the only family with no boundary check: a row
 * without a name reached the club list as `undefined` and was persisted that
 * way.
 */
function toApiClubAthlete(value: unknown): ApiClubAthlete | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  for (const field of CLUB_ATHLETE_STRING_FIELDS) {
    if (!isNonEmptyString(row[field])) return null;
  }
  return row as unknown as ApiClubAthlete;
}

/**
 * The `/clubs/meet-stats` body, or a thrown error naming the first bad field.
 * Every count is rendered with `toFixed`/arithmetic in the stats card, and a
 * string or `null` that got past here was persisted and then threw on every
 * later render of that card, offline included. The make rates are optional
 * (older backends omit them) but must be numbers when present.
 */
function toApiClubMeetStats(value: unknown): ApiClubMeetStats {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('[api] /clubs/meet-stats: expected an object');
  }
  const row = value as Record<string, unknown>;
  for (const field of CLUB_MEET_STATS_REQUIRED_FIELDS) {
    if (!isFiniteNumber(row[field])) {
      throw new Error(`[api] /clubs/meet-stats: ${field} is not a finite number`);
    }
  }
  for (const field of CLUB_MEET_STATS_OPTIONAL_FIELDS) {
    const rate = row[field];
    if (rate !== undefined && rate !== null && !isFiniteNumber(rate)) {
      throw new Error(`[api] /clubs/meet-stats: ${field} is not a finite number`);
    }
  }
  return row as unknown as ApiClubMeetStats;
}

function mapClubMeetStats(row: ApiClubMeetStats): ClubMeetStats {
  return {
    totalAthletes: row.total_athletes,
    goldMedals: row.gold_medals,
    silverMedals: row.silver_medals,
    bronzeMedals: row.bronze_medals,
    totalPRs: row.total_prs,
    perfect6for6: row.perfect_6_for_6,
    totalWeightLifted: row.total_weight_lifted,
    snatchMakeRate: row.snatch_make_rate ?? 0,
    cjMakeRate: row.cj_make_rate ?? 0,
    combinedMakeRate: row.combined_make_rate ?? 0,
  };
}

async function readClubsCache() {
  const cached = await getOfflineCache<string[]>(OFFLINE_CACHE_KEYS.clubs);
  return cached ? { data: cached.data, lastUpdatedAt: cached.lastSynced } : null;
}

function readClubAthletesCache(club: string) {
  return readBoundedCacheEntry<AthleteClub[]>(OFFLINE_CACHE_KEYS.clubAthletes, club);
}

async function readClubMeetStatsCache(club: string, meet: string) {
  const cached = await readBoundedCacheEntry<ClubMeetStats & { athleteResults?: unknown }>(
    OFFLINE_CACHE_KEYS.clubMeetStats,
    getClubMeetStatsKey(club, meet),
  );
  if (!cached) return null;
  // Entries stored before the per-athlete list was dropped still carry it.
  const { athleteResults: _unused, ...stats } = cached.data;
  return { data: stats, lastUpdatedAt: cached.lastUpdatedAt };
}

async function fetchAllClubsFresh(): Promise<string[]> {
  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) throw new Error('Offline');
  return fetchApiClubNames();
}

async function fetchAthletesByClubFresh(club: string): Promise<AthleteClub[]> {
  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) throw new Error('Offline');
  const rows = await getJsonArray<unknown>('/clubs/athletes', { club });
  const athletes: AthleteClub[] = [];
  for (const value of rows) {
    const row = toApiClubAthlete(value);
    if (!row) continue;
    athletes.push({
      member_id: row.member_id,
      name: row.name,
      club: row.club,
      meet: row.meet,
    });
  }
  if (athletes.length !== rows.length) {
    console.warn(
      `[api] /clubs/athletes: dropped ${rows.length - athletes.length} of ${rows.length} malformed athlete rows`,
    );
  }
  return athletes;
}

async function fetchClubMeetStatsFresh(club: string, meet: string): Promise<ClubMeetStats> {
  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) throw new Error('Offline');
  const response = await getJsonObject<unknown>('/clubs/meet-stats', {
    club,
    meet,
  });
  return mapClubMeetStats(toApiClubMeetStats(response));
}

async function persistClubs(clubs: string[]) {
  const entry = await setOfflineCache(OFFLINE_CACHE_KEYS.clubs, clubs);
  return { data: entry.data, lastUpdatedAt: entry.lastSynced };
}

function persistClubAthletes(club: string, athletes: AthleteClub[]) {
  return writeBoundedCacheEntry(
    OFFLINE_CACHE_KEYS.clubAthletes,
    club,
    athletes,
    MAX_CACHED_CLUB_ATHLETE_LISTS,
  );
}

function persistClubMeetStats(club: string, meet: string, stats: ClubMeetStats) {
  return writeBoundedCacheEntry(
    OFFLINE_CACHE_KEYS.clubMeetStats,
    getClubMeetStatsKey(club, meet),
    stats,
    MAX_CACHED_CLUB_MEET_STATS,
  );
}

export const clubsResource = createMutableResource<string[], []>({
  getKey: () => OFFLINE_CACHE_KEYS.clubs,
  loadCached: () => readClubsCache(),
  fetchFresh: () => fetchAllClubsFresh(),
  persistFresh: (data) => persistClubs(data),
});

export const clubAthletesResource = createMutableResource<AthleteClub[], [string]>({
  getKey: (club) => `${OFFLINE_CACHE_KEYS.clubAthletes}:${club}`,
  loadCached: (club) => readClubAthletesCache(club),
  fetchFresh: (club) => fetchAthletesByClubFresh(club),
  persistFresh: (data, club) => persistClubAthletes(club, data),
});

export const clubMeetStatsResource = createMutableResource<ClubMeetStats, [string, string]>({
  getKey: (club, meet) => `${OFFLINE_CACHE_KEYS.clubMeetStats}:${club}:${meet}`,
  loadCached: (club, meet) => readClubMeetStatsCache(club, meet),
  fetchFresh: (club, meet) => fetchClubMeetStatsFresh(club, meet),
  persistFresh: (data, club, meet) => persistClubMeetStats(club, meet, data),
});

