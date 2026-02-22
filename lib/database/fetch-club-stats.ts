import { convex } from '@/lib/convex';
import { api } from '@/convex/_generated/api';
import type {
  AthleteClub,
  ClubMeetStats,
  AthleteResult,
  AthleteInfo,
  AthleteWeightClass,
  MeetStatus
} from '@/types/club';

const clubsMemoryCache: { data: string[] | null } = { data: null };
let inFlightClubs: Promise<string[]> | null = null;
const athletesByClubCache = new Map<string, AthleteClub[]>();
const athletesByClubInFlight = new Map<string, Promise<AthleteClub[]>>();
const clubMeetStatsCache = new Map<string, ClubMeetStats>();
const clubMeetStatsInFlight = new Map<string, Promise<ClubMeetStats>>();

function getClubMeetStatsKey(club: string, meet: string): string {
  return `${club}::${meet}`;
}

async function fetchAndStoreClubs(): Promise<string[]> {
  const clubs = await convex.query(api.athletes.listClubs, {});
  clubsMemoryCache.data = clubs;
  return clubs;
}

/**
 * Fetch all unique clubs from the database
 */
export async function fetchAllClubs(): Promise<string[]> {
  if (clubsMemoryCache.data) {
    if (!inFlightClubs) {
      inFlightClubs = fetchAndStoreClubs().finally(() => {
        inFlightClubs = null;
      });
    }
    return clubsMemoryCache.data;
  }
  if (inFlightClubs) {
    return inFlightClubs;
  }

  inFlightClubs = (async () => {
    try {
      return await fetchAndStoreClubs();
    } catch (error) {
      console.error('Error in fetchAllClubs:', error);
      throw error;
    } finally {
      inFlightClubs = null;
    }
  })();

  return inFlightClubs;
}

/**
 * Fetch all athletes from a specific club, filtered to only completed meets
 */
export async function fetchAthletesByClub(club: string): Promise<AthleteClub[]> {
  const cached = athletesByClubCache.get(club);
  if (cached) {
    return cached;
  }

  const inFlight = athletesByClubInFlight.get(club);
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    try {
    // First get all athletes from this club
    const allAthletes = await convex.query(api.athletes.getByClub, { club }) as unknown as AthleteClub[];

    // Get the unique meets from these athletes
    const uniqueMeets = Array.from(new Set(allAthletes.map(a => a.meet)));

    if (uniqueMeets.length === 0) {
      return [];
    }

    // Fetch the status of these meets
    const meetsData = await Promise.all(uniqueMeets.map(name => convex.query(api.meets.getByName, { name })));
    const meetsWithStatus = meetsData.filter(Boolean) as MeetStatus[];

    // Filter to only keep completed meets
    const completedMeetNames = new Set(
      meetsWithStatus.filter(m => m.status === 'completed').map(m => m.name)
    );

    // Filter athletes to only those in completed meets
    const filteredAthletes = allAthletes.filter(a => completedMeetNames.has(a.meet));

    athletesByClubCache.set(club, filteredAthletes);
    return filteredAthletes;
  } catch (error) {
    console.error('Error in fetchAthletesByClub:', error);
    throw error;
  } finally {
    athletesByClubInFlight.delete(club);
  }
  })();

  athletesByClubInFlight.set(club, request);
  return request;
}

/**
 * Fetch and calculate stats for a specific club at a specific meet
 */
export async function fetchClubMeetStats(club: string, meet: string): Promise<ClubMeetStats> {
  const cacheKey = getClubMeetStatsKey(club, meet);
  const cached = clubMeetStatsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const inFlight = clubMeetStatsInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    try {
    // Step 1: Get all athletes from this club at this meet
    const clubAthletes = await convex.query(api.athletes.getByClubAndMeet, { club, meet }) as unknown as AthleteInfo[];
    const athleteNames = clubAthletes.map(a => a.name);

    if (athleteNames.length === 0) {
      return {
        totalAthletes: 0,
        goldMedals: 0,
        silverMedals: 0,
        bronzeMedals: 0,
        totalPRs: 0,
        perfect6for6: 0,
        totalWeightLifted: 0,
        athleteResults: []
      };
    }

    // Steps 2+3+4: Fetch all meet data in parallel
    const [allMeetLiftingRaw, allMeetAthletes] = await Promise.all([
      convex.query(api.liftingResults.getByMeet, { meet }),
      convex.query(api.athletes.getByMeet, { meet }),
    ]);

    // Club athletes' results at this meet
    const results = allMeetLiftingRaw.filter(r => athleteNames.includes(r.name)) as unknown as AthleteResult[];
    const allMeetResults = allMeetLiftingRaw as unknown as AthleteResult[];

    // Step 5: Get historical results for PR calculations
    const firstDate = results.length > 0 ? (results[0] as any).date : new Date().toISOString();
    const historicalRaw = await convex.query(api.liftingResults.getByNames, { names: athleteNames });
    const historicalFiltered = historicalRaw.filter(r => r.federation !== 'BWL' && r.date < firstDate);

    const historicalByAthlete = new Map<string, number>();
    historicalFiltered.forEach((row) => {
      if (!row.name || row.total == null) return;
      const currentBest = historicalByAthlete.get(row.name) ?? 0;
      if ((row.total ?? 0) > currentBest) {
        historicalByAthlete.set(row.name, row.total ?? 0);
      }
    });

    // Calculate stats
    const stats: ClubMeetStats = {
      totalAthletes: results.length,
      goldMedals: 0,
      silverMedals: 0,
      bronzeMedals: 0,
      totalPRs: 0,
      perfect6for6: 0,
      totalWeightLifted: 0,
      athleteResults: results
    };

    // Calculate total weight lifted
    stats.totalWeightLifted = results.reduce((sum, r) => sum + r.total, 0);

    // Calculate 6/6 days
    for (const result of results) {
      const lifts = [result.snatch1, result.snatch2, result.snatch3, result.cj1, result.cj2, result.cj3];
      const allGood = lifts.every(lift => lift > 0);
      if (allGood) {
        stats.perfect6for6++;
      }
    }

    // Calculate PRs by comparing to historical bests
    for (const result of results) {
      const bestHistorical = historicalByAthlete.get(result.name) ?? 0;

      if (result.total > bestHistorical) {
        stats.totalPRs++;
      }
    }

    // Calculate medals - check snatch, c&j, and total separately by weight class
    for (const clubAthlete of clubAthletes) {
      const athleteResult = results.find(r => r.name === clubAthlete.name);
      if (!athleteResult) continue;

      // Get all results in this athlete's weight class
      const athletesInWeightClass = (allMeetAthletes as any[]).filter(
        a => (a.weightClass ?? a.weight_class) === (clubAthlete as any).weightClass
      );
      const namesInWeightClass = athletesInWeightClass.map((a: any) => a.name);
      const resultsInWeightClass = allMeetResults.filter(
        r => namesInWeightClass.includes(r.name) && r.total > 0
      );

      // Medal for SNATCH
      const sortedBySnatch = [...resultsInWeightClass].sort((a, b) => ((b as any).snatchBest ?? (b as any).snatch_best ?? 0) - ((a as any).snatchBest ?? (a as any).snatch_best ?? 0));
      const snatchRank = sortedBySnatch.findIndex(r => r.name === clubAthlete.name);
      if (snatchRank === 0) stats.goldMedals++;
      else if (snatchRank === 1) stats.silverMedals++;
      else if (snatchRank === 2) stats.bronzeMedals++;

      // Medal for CLEAN & JERK
      const sortedByCJ = [...resultsInWeightClass].sort((a, b) => ((b as any).cjBest ?? (b as any).cj_best ?? 0) - ((a as any).cjBest ?? (a as any).cj_best ?? 0));
      const cjRank = sortedByCJ.findIndex(r => r.name === clubAthlete.name);
      if (cjRank === 0) stats.goldMedals++;
      else if (cjRank === 1) stats.silverMedals++;
      else if (cjRank === 2) stats.bronzeMedals++;

      // Medal for TOTAL
      const sortedByTotal = [...resultsInWeightClass].sort((a, b) => b.total - a.total);
      const totalRank = sortedByTotal.findIndex(r => r.name === clubAthlete.name);
      if (totalRank === 0) stats.goldMedals++;
      else if (totalRank === 1) stats.silverMedals++;
      else if (totalRank === 2) stats.bronzeMedals++;
    }

    clubMeetStatsCache.set(cacheKey, stats);
    return stats;
  } catch (error) {
    console.error('Error in fetchClubMeetStats:', error);
    throw error;
  } finally {
    clubMeetStatsInFlight.delete(cacheKey);
  }
  })();

  clubMeetStatsInFlight.set(cacheKey, request);
  return request;
}
