import { supabase } from '@/lib/supabase';
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

async function fetchAndStoreClubs(): Promise<string[]> {
  const { data, error } = await supabase
    .from('athletes')
    .select('club')
    .order('club');

  if (error) {
    console.error('Error fetching clubs:', error);
    throw error;
  }

  const clubRows = (data || []) as Array<{ club: string | null }>;
  const uniqueClubs = Array.from(new Set(clubRows.map((row) => row.club).filter(Boolean))).sort() as string[];
  clubsMemoryCache.data = uniqueClubs;
  return uniqueClubs;
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
  try {
    // First get all athletes from this club
    const { data: athletesData, error: athletesError } = await supabase
      .from('athletes')
      .select('member_id, name, club, meet')
      .eq('club', club);

    if (athletesError) {
      console.error('Error fetching athletes:', athletesError);
      throw athletesError;
    }

    const allAthletes = athletesData as AthleteClub[];

    // Get the unique meets from these athletes
    const uniqueMeets = Array.from(new Set(allAthletes.map(a => a.meet)));

    if (uniqueMeets.length === 0) {
      return [];
    }

    // Fetch the status of these meets
    const { data: meetsData, error: meetsError } = await supabase
      .from('meets')
      .select('name, status')
      .in('name', uniqueMeets);

    if (meetsError) {
      console.error('Error fetching meet status:', meetsError);
      throw meetsError;
    }

    const meetsWithStatus = meetsData as MeetStatus[];

    // Filter to only keep completed meets
    const completedMeetNames = new Set(
      meetsWithStatus.filter(m => m.status === 'completed').map(m => m.name)
    );

    // Filter athletes to only those in completed meets
    const filteredAthletes = allAthletes.filter(a => completedMeetNames.has(a.meet));

    return filteredAthletes;
  } catch (error) {
    console.error('Error in fetchAthletesByClub:', error);
    throw error;
  }
}

/**
 * Fetch and calculate stats for a specific club at a specific meet
 */
export async function fetchClubMeetStats(club: string, meet: string): Promise<ClubMeetStats> {
  try {
    // Step 1: Get all athletes from this club at this meet
    const { data: athletesData, error: athletesError } = await supabase
      .from('athletes')
      .select('name, age, gender, weight_class')
      .eq('club', club)
      .eq('meet', meet);

    if (athletesError) {
      console.error('Error fetching athletes:', athletesError);
      throw athletesError;
    }

    const clubAthletes = athletesData as AthleteInfo[];
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

    // Step 2: Get lifting results for these athletes at this meet
    const { data: resultsData, error: resultsError } = await supabase
      .from('lifting_results')
      .select('*')
      .in('name', athleteNames)
      .eq('meet', meet);

    if (resultsError) {
      console.error('Error fetching results:', resultsError);
      throw resultsError;
    }

    const results = resultsData as AthleteResult[];

    // Step 3: Get ALL athletes info from this meet for medal calculations
    const { data: allMeetAthletesData, error: allMeetAthletesError } = await supabase
      .from('athletes')
      .select('name, weight_class')
      .eq('meet', meet);

    if (allMeetAthletesError) {
      console.error('Error fetching all meet athletes:', allMeetAthletesError);
      throw allMeetAthletesError;
    }

    const allMeetAthletes = allMeetAthletesData as AthleteWeightClass[];

    // Step 4: Get all lifting results from this meet
    const { data: allMeetResultsData, error: allMeetResultsError } = await supabase
      .from('lifting_results')
      .select('*')
      .eq('meet', meet);

    if (allMeetResultsError) {
      console.error('Error fetching all meet results:', allMeetResultsError);
      throw allMeetResultsError;
    }

    const allMeetResults = allMeetResultsData as AthleteResult[];

    // Step 5: Get historical results for PR calculations
    const firstDate = results.length > 0 ? results[0].date : new Date().toISOString();
    const { data: historicalData, error: historicalError } = await supabase
      .from('lifting_results')
      .select('*')
      .neq('federation', 'BWL')
      .in('name', athleteNames)
      .lt('date', firstDate);

    if (historicalError) {
      console.error('Error fetching historical results:', historicalError);
      throw historicalError;
    }

    const historicalResults = historicalData as AthleteResult[];

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
      const athleteHistory = historicalResults.filter(h => h.name === result.name);
      const bestHistorical = Math.max(0, ...athleteHistory.map(h => h.total));

      if (result.total > bestHistorical) {
        stats.totalPRs++;
      }
    }

    // Calculate medals - check snatch, c&j, and total separately by weight class
    for (const clubAthlete of clubAthletes) {
      const athleteResult = results.find(r => r.name === clubAthlete.name);
      if (!athleteResult) continue;

      // Get all results in this athlete's weight class
      const athletesInWeightClass = allMeetAthletes.filter(
        a => a.weight_class === clubAthlete.weight_class
      );
      const namesInWeightClass = athletesInWeightClass.map(a => a.name);
      const resultsInWeightClass = allMeetResults.filter(
        r => namesInWeightClass.includes(r.name) && r.total > 0
      );

      // Medal for SNATCH
      const sortedBySnatch = [...resultsInWeightClass].sort((a, b) => b.snatch_best - a.snatch_best);
      const snatchRank = sortedBySnatch.findIndex(r => r.name === clubAthlete.name);
      if (snatchRank === 0) stats.goldMedals++;
      else if (snatchRank === 1) stats.silverMedals++;
      else if (snatchRank === 2) stats.bronzeMedals++;

      // Medal for CLEAN & JERK
      const sortedByCJ = [...resultsInWeightClass].sort((a, b) => b.cj_best - a.cj_best);
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

    return stats;
  } catch (error) {
    console.error('Error in fetchClubMeetStats:', error);
    throw error;
  }
}
