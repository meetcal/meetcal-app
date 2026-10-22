import { createMutableResource } from '@/lib/data/mutable-resource';
import { clubMeetsNewestFirst, type ClubMeet } from '@/lib/club-meets';
import type { AthleteClub, ClubMeetStats } from '@/types/club';
import {
  getOfflineCache,
  OFFLINE_CACHE_KEYS,
  readBoundedCacheEntry,
  setOfflineCache,
  writeBoundedCacheEntry,
} from './offline-cache';
import { isNetworkAvailable } from '@/lib/networkUtils';
import { fetchApiClubMeets, fetchApiClubMeetStats, fetchApiClubNames } from '@/lib/api/meetcal-api';

/**
 * Clubs whose meet lists stay cached for offline browsing. A list is one
 * short row per meet, a few KB for a big club; 20 covers a coach's own club
 * and the rivals they look up.
 */
export const MAX_CACHED_CLUB_MEET_LISTS = 20;

/**
 * Club + meet stat cards kept for offline browsing. A card is ten numbers
 * (~300 bytes), so 50 is a season of a club's meets for a few clubs in ~15KB.
 */
export const MAX_CACHED_CLUB_MEET_STATS = 50;

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

/**
 * A club's cached meets; without them, the meets of the club's athlete list
 * an app version before #209 cached, so an update keeps what was browsed
 * offline.
 */
async function readClubMeetsCache(club: string) {
  const cached = await readBoundedCacheEntry<ClubMeet[]>(OFFLINE_CACHE_KEYS.clubMeets, club);
  if (cached) return cached;
  const legacy = await readBoundedCacheEntry<unknown>(OFFLINE_CACHE_KEYS.clubAthletes, club);
  if (!legacy || !Array.isArray(legacy.data)) return null;
  const athletes = legacy.data.filter(
    (row: unknown): row is AthleteClub => !!row && typeof row === 'object' && isNonEmptyString((row as AthleteClub).meet),
  );
  return {
    data: clubMeetsNewestFirst(athletes.map((athlete) => ({ meet: athlete.meet, date: athlete.meet_date }))),
    lastUpdatedAt: legacy.lastUpdatedAt,
  };
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

async function fetchClubMeetsFresh(club: string): Promise<ClubMeet[]> {
  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) throw new Error('Offline');
  return clubMeetsNewestFirst(await fetchApiClubMeets(club));
}

async function fetchClubMeetStatsFresh(club: string, meet: string): Promise<ClubMeetStats> {
  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) throw new Error('Offline');
  const response = await fetchApiClubMeetStats(club, meet);
  return mapClubMeetStats(toApiClubMeetStats(response));
}

async function persistClubs(clubs: string[]) {
  const entry = await setOfflineCache(OFFLINE_CACHE_KEYS.clubs, clubs);
  return { data: entry.data, lastUpdatedAt: entry.lastSynced };
}

function persistClubMeets(club: string, meets: ClubMeet[]) {
  return writeBoundedCacheEntry(OFFLINE_CACHE_KEYS.clubMeets, club, meets, MAX_CACHED_CLUB_MEET_LISTS);
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

/** A club's meets, newest first (`reference:clubMeets`). */
export const clubMeetsResource = createMutableResource<ClubMeet[], [string]>({
  getKey: (club) => `${OFFLINE_CACHE_KEYS.clubMeets}:${club}`,
  loadCached: (club) => readClubMeetsCache(club),
  fetchFresh: (club) => fetchClubMeetsFresh(club),
  persistFresh: (data, club) => persistClubMeets(club, data),
});

export const clubMeetStatsResource = createMutableResource<ClubMeetStats, [string, string]>({
  getKey: (club, meet) => `${OFFLINE_CACHE_KEYS.clubMeetStats}:${club}:${meet}`,
  loadCached: (club, meet) => readClubMeetStatsCache(club, meet),
  fetchFresh: (club, meet) => fetchClubMeetStatsFresh(club, meet),
  persistFresh: (data, club, meet) => persistClubMeetStats(club, meet, data),
});

