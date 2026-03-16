import { convex } from '@/lib/convex';
import { api } from '@/convex/_generated/api';
import { createMutableResource } from '@/lib/data/mutable-resource';
import {
  AthleteClub,
  ClubMeetStats,
  AthleteResult,
  AthleteInfo,
  MeetStatus,
} from '@/types/club';
import { getOfflineCache, OFFLINE_CACHE_KEYS, setOfflineCache } from './offline-cache';
import { isNetworkAvailable } from '@/lib/networkUtils';

type ClubAthletesCache = Record<string, AthleteClub[]>;
type ClubMeetStatsCache = Record<string, ClubMeetStats>;

function getClubMeetStatsKey(club: string, meet: string): string {
  return `${club}::${meet}`;
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
  if (!hasNetwork) {
    throw new Error('Offline');
  }
  return await convex.query(api.athletes.listClubs, {});
}

async function fetchAthletesByClubFresh(club: string): Promise<AthleteClub[]> {
  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) {
    throw new Error('Offline');
  }

  const allAthletes = await convex.query(api.athletes.getByClub, { club }) as unknown as AthleteClub[];
  const uniqueMeets = Array.from(new Set(allAthletes.map((athlete) => athlete.meet)));
  if (uniqueMeets.length === 0) {
    return [];
  }

  const meetsData = await Promise.all(
    uniqueMeets.map((name) => convex.query(api.meets.getByName, { name })),
  );
  const meetsWithStatus = meetsData.filter(Boolean) as MeetStatus[];
  const completedMeetNames = new Set(
    meetsWithStatus.filter((meet) => meet.status === 'completed').map((meet) => meet.name),
  );
  return allAthletes.filter((athlete) => completedMeetNames.has(athlete.meet));
}

async function fetchClubMeetStatsFresh(club: string, meet: string): Promise<ClubMeetStats> {
  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) {
    throw new Error('Offline');
  }

  const clubAthletes = await convex.query(api.athletes.getByClubAndMeet, { club, meet }) as unknown as AthleteInfo[];
  const athleteNames = clubAthletes.map((athlete) => athlete.name);

  if (athleteNames.length === 0) {
    return {
      totalAthletes: 0,
      goldMedals: 0,
      silverMedals: 0,
      bronzeMedals: 0,
      totalPRs: 0,
      perfect6for6: 0,
      totalWeightLifted: 0,
      athleteResults: [],
    };
  }

  const [allMeetLiftingRaw, allMeetAthletes] = await Promise.all([
    convex.query(api.liftingResults.getByMeet, { meet }),
    convex.query(api.athletes.getByMeet, { meet }),
  ]);

  const results = allMeetLiftingRaw.filter((row) => athleteNames.includes(row.name)) as unknown as AthleteResult[];
  const allMeetResults = allMeetLiftingRaw as unknown as AthleteResult[];
  const firstDate = results.length > 0 ? (results[0] as { date?: string }).date ?? new Date().toISOString() : new Date().toISOString();
  const historicalRaw = await convex.query(api.liftingResults.getByNames, { names: athleteNames });
  const historicalFiltered = historicalRaw.filter(
    (row) => row.federation !== 'BWL' && row.date < firstDate,
  );

  const historicalByAthlete = new Map<string, number>();
  historicalFiltered.forEach((row) => {
    if (!row.name || row.total == null) return;
    const currentBest = historicalByAthlete.get(row.name) ?? 0;
    if ((row.total ?? 0) > currentBest) {
      historicalByAthlete.set(row.name, row.total ?? 0);
    }
  });

  const stats: ClubMeetStats = {
    totalAthletes: results.length,
    goldMedals: 0,
    silverMedals: 0,
    bronzeMedals: 0,
    totalPRs: 0,
    perfect6for6: 0,
    totalWeightLifted: results.reduce((sum, row) => sum + row.total, 0),
    athleteResults: results,
  };

  for (const result of results) {
    const lifts = [result.snatch1, result.snatch2, result.snatch3, result.cj1, result.cj2, result.cj3];
    if (lifts.every((lift) => lift > 0)) {
      stats.perfect6for6 += 1;
    }

    const bestHistorical = historicalByAthlete.get(result.name) ?? 0;
    if (result.total > bestHistorical) {
      stats.totalPRs += 1;
    }
  }

  for (const clubAthlete of clubAthletes) {
    const athleteResult = results.find((result) => result.name === clubAthlete.name);
    if (!athleteResult) continue;

    const athletesInWeightClass = (allMeetAthletes as Array<{ weightClass?: string; weight_class?: string; name: string }>).filter(
      (athlete) => (athlete.weightClass ?? athlete.weight_class) === (clubAthlete as { weightClass?: string }).weightClass,
    );
    const namesInWeightClass = athletesInWeightClass.map((athlete) => athlete.name);
    const resultsInWeightClass = allMeetResults.filter(
      (result) => namesInWeightClass.includes(result.name) && result.total > 0,
    );

    const sortedBySnatch = [...resultsInWeightClass].sort(
      (left, right) =>
        ((right as AthleteResult & { snatchBest?: number; snatch_best?: number }).snatchBest ??
          (right as AthleteResult & { snatchBest?: number; snatch_best?: number }).snatch_best ??
          0) -
        ((left as AthleteResult & { snatchBest?: number; snatch_best?: number }).snatchBest ??
          (left as AthleteResult & { snatchBest?: number; snatch_best?: number }).snatch_best ??
          0),
    );
    const snatchRank = sortedBySnatch.findIndex((result) => result.name === clubAthlete.name);
    if (snatchRank === 0) stats.goldMedals += 1;
    else if (snatchRank === 1) stats.silverMedals += 1;
    else if (snatchRank === 2) stats.bronzeMedals += 1;

    const sortedByCJ = [...resultsInWeightClass].sort(
      (left, right) =>
        ((right as AthleteResult & { cjBest?: number; cj_best?: number }).cjBest ??
          (right as AthleteResult & { cjBest?: number; cj_best?: number }).cj_best ??
          0) -
        ((left as AthleteResult & { cjBest?: number; cj_best?: number }).cjBest ??
          (left as AthleteResult & { cjBest?: number; cj_best?: number }).cj_best ??
          0),
    );
    const cjRank = sortedByCJ.findIndex((result) => result.name === clubAthlete.name);
    if (cjRank === 0) stats.goldMedals += 1;
    else if (cjRank === 1) stats.silverMedals += 1;
    else if (cjRank === 2) stats.bronzeMedals += 1;

    const sortedByTotal = [...resultsInWeightClass].sort((left, right) => right.total - left.total);
    const totalRank = sortedByTotal.findIndex((result) => result.name === clubAthlete.name);
    if (totalRank === 0) stats.goldMedals += 1;
    else if (totalRank === 1) stats.silverMedals += 1;
    else if (totalRank === 2) stats.bronzeMedals += 1;
  }

  return stats;
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

export async function fetchAllClubs(): Promise<string[]> {
  try {
    const clubs = await fetchAllClubsFresh();
    await persistClubs(clubs);
    return clubs;
  } catch (error) {
    const cached = await readClubsCache();
    if (cached?.data) {
      return cached.data;
    }
    console.error('Error in fetchAllClubs:', error);
    throw error;
  }
}

export async function fetchAthletesByClub(club: string): Promise<AthleteClub[]> {
  try {
    const athletes = await fetchAthletesByClubFresh(club);
    await persistClubAthletes(club, athletes);
    return athletes;
  } catch (error) {
    const cached = await readClubAthletesCache(club);
    if (cached?.data) {
      return cached.data;
    }
    console.error('Error in fetchAthletesByClub:', error);
    throw error;
  }
}

export async function fetchClubMeetStats(club: string, meet: string): Promise<ClubMeetStats> {
  try {
    const stats = await fetchClubMeetStatsFresh(club, meet);
    await persistClubMeetStats(club, meet, stats);
    return stats;
  } catch (error) {
    const cached = await readClubMeetStatsCache(club, meet);
    if (cached?.data) {
      return cached.data;
    }
    console.error('Error in fetchClubMeetStats:', error);
    throw error;
  }
}
