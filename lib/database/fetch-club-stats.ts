import { createMutableResource } from '@/lib/data/mutable-resource';
import {
  AthleteClub,
  ClubMeetStats,
  AthleteResult,
} from '@/types/club';
import { getOfflineCache, OFFLINE_CACHE_KEYS, setOfflineCache } from './offline-cache';
import { isNetworkAvailable } from '@/lib/networkUtils';
import { fetchApiClubNames, getJson } from '@/lib/api/meetcal-api';

type ClubAthletesCache = Record<string, AthleteClub[]>;
type ClubMeetStatsCache = Record<string, ClubMeetStats>;

type ApiClubAthlete = {
  member_id: string;
  name: string;
  meet: string;
  club: string;
  gender?: string;
  weight_class?: string;
  entry_total?: number;
};

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
  athlete_results: {
    name: string;
    weight_class: string;
    snatch_best: number;
    cj_best: number;
    total: number;
    body_weight: number;
    medal?: string | null;
    snatch_medal?: string | null;
    cj_medal?: string | null;
    total_medal?: string | null;
    is_pr: boolean;
    perfect_lifts: boolean;
  }[];
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
    athleteResults: row.athlete_results.map((result, index) => ({
      id: index,
      event_id: '',
      meet: '',
      date: '',
      name: result.name,
      age: 0,
      body_weight: result.body_weight,
      snatch1: 0,
      snatch2: 0,
      snatch3: 0,
      snatch_best: result.snatch_best,
      cj1: 0,
      cj2: 0,
      cj3: 0,
      cj_best: result.cj_best,
      total: result.total,
      weight_class: result.weight_class,
      medal: result.medal ?? undefined,
      snatch_medal: result.snatch_medal ?? undefined,
      cj_medal: result.cj_medal ?? undefined,
      total_medal: result.total_medal ?? undefined,
      is_pr: result.is_pr,
      perfect_lifts: result.perfect_lifts,
    } as AthleteResult)),
  };
}

async function readClubsCache() {
  const cached = await getOfflineCache<string[]>(OFFLINE_CACHE_KEYS.clubs);
  return cached ? { data: cached.data, lastUpdatedAt: cached.lastSynced } : null;
}

async function readClubAthletesCache(club: string) {
  const cached = await getOfflineCache<ClubAthletesCache>(OFFLINE_CACHE_KEYS.clubAthletes);
  const data = cached?.data?.[club];
  return data ? { data, lastUpdatedAt: cached.lastSynced } : null;
}

async function readClubMeetStatsCache(club: string, meet: string) {
  const cached = await getOfflineCache<ClubMeetStatsCache>(OFFLINE_CACHE_KEYS.clubMeetStats);
  const data = cached?.data?.[getClubMeetStatsKey(club, meet)];
  return data ? { data, lastUpdatedAt: cached.lastSynced } : null;
}

async function fetchAllClubsFresh(): Promise<string[]> {
  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) throw new Error('Offline');
  return fetchApiClubNames();
}

async function fetchAthletesByClubFresh(club: string): Promise<AthleteClub[]> {
  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) throw new Error('Offline');
  const rows = await getJson<ApiClubAthlete[]>('/clubs/athletes', { club });
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
  const response = await getJson<ApiClubMeetStats>('/clubs/meet-stats', { club, meet });
  return mapClubMeetStats(response);
}

async function persistClubs(clubs: string[]) {
  const entry = await setOfflineCache(OFFLINE_CACHE_KEYS.clubs, clubs);
  return { data: entry.data, lastUpdatedAt: entry.lastSynced };
}

async function persistClubAthletes(club: string, athletes: AthleteClub[]) {
  const cached = await getOfflineCache<ClubAthletesCache>(OFFLINE_CACHE_KEYS.clubAthletes);
  const nextCache: ClubAthletesCache = {
    ...(cached?.data || {}),
    [club]: athletes,
  };
  const entry = await setOfflineCache(OFFLINE_CACHE_KEYS.clubAthletes, nextCache);
  return { data: athletes, lastUpdatedAt: entry.lastSynced };
}

async function persistClubMeetStats(club: string, meet: string, stats: ClubMeetStats) {
  const cacheKey = getClubMeetStatsKey(club, meet);
  const cached = await getOfflineCache<ClubMeetStatsCache>(OFFLINE_CACHE_KEYS.clubMeetStats);
  const nextCache: ClubMeetStatsCache = {
    ...(cached?.data || {}),
    [cacheKey]: stats,
  };
  const entry = await setOfflineCache(OFFLINE_CACHE_KEYS.clubMeetStats, nextCache);
  return { data: stats, lastUpdatedAt: entry.lastSynced };
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

