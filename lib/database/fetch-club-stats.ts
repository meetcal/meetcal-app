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
  snatch_make_rate?: number;
  cj_make_rate?: number;
  combined_make_rate?: number;
};

function getClubMeetStatsKey(club: string, meet: string): string {
  return `${club}::${meet}`;
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
  const rows = await getJsonArray<ApiClubAthlete>('/clubs/athletes', { club });
  return rows.map((row) => ({
    member_id: row.member_id,
    name: row.name,
    club: row.club,
    meet: row.meet,
  }));
}

async function fetchClubMeetStatsFresh(club: string, meet: string): Promise<ClubMeetStats> {
  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) throw new Error('Offline');
  const response = await getJsonObject<ApiClubMeetStats>('/clubs/meet-stats', {
    club,
    meet,
  });
  return mapClubMeetStats(response);
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

