import { MeetName } from '@/data/types/meet';
import { normalizeAthleteName } from '@/lib/athletes';
import { getMeetData, getMeetLiftingResults } from '@/lib/database/meet-data-reads';
import { saveAthleteBestsBatch } from '@/lib/database/athlete-bests-store';
import { saveMeetAthletes, saveMeetLiftingResults, saveMeetSchedule } from '@/lib/database/meet-data-saves';
import { type ApiMeetPackage, fetchApiMeetPackageConditional } from '@/lib/api/meet-package-api';
import { mapApiAthletes, mapApiLiftingResult } from '@/lib/api/api-athlete-mappers';
import { mapPackageSchedule } from '@/lib/api/api-meet-mappers';
import { clearPackageEtag, getStoredPackageEtag } from './package-etags';
import { namesWithChangedPackageData, packageYearBests, readPackageBestsSnapshot, writePackageBestsSnapshot } from './package-bests-snapshot';
import { addPendingHistoryNames } from './history-download-state';

export function validatePrefetchedLiftingResults(
  meet: MeetName,
  athleteNames: string[],
  liftingResults: { name?: string | null }[],
): void {
  if (athleteNames.length > 0 && liftingResults.length > 0) {
    const athleteSet = new Set(athleteNames.map(normalizeAthleteName));
    const matchedCount = liftingResults.reduce((count, result) => {
      return athleteSet.has(normalizeAthleteName(result.name)) ? count + 1 : count;
    }, 0);

    if (matchedCount === 0) {
      throw new Error(`No matched lifting results fetched for meet athletes: ${meet}`);
    }
  }
}

async function readLocalRosterNames(meet: MeetName): Promise<string[] | null> {
  try {
    const data = await getMeetData(meet);
    const names = uniqueAthleteNames(data.athletes ?? []);
    return names.length > 0 ? names : null;
  } catch {
    return null;
  }
}

export function uniqueAthleteNames(athletes: readonly { name: string }[]): string[] {
  return Array.from(new Set(athletes.map((athlete) => athlete.name).filter(Boolean)));
}

type PackageForPrefetch =
  | {
      status: 'fresh';
      etag: string | null;
      package: ApiMeetPackage;
      replacesIngested: boolean;
    }
  | { status: 'not_modified'; athleteNames: string[] };

export async function fetchPackageForPrefetch(
  meet: MeetName,
  historyCutoffDate: string,
): Promise<PackageForPrefetch> {
  const storedEtag = await getStoredPackageEtag(meet);
  const fetched = await fetchApiMeetPackageConditional(meet, historyCutoffDate, storedEtag);
  if (fetched.status === 'fresh') {
    return { ...fetched, replacesIngested: storedEtag !== null };
  }
  const localNames = await readLocalRosterNames(meet);
  if (localNames) {
    return { status: 'not_modified', athleteNames: localNames };
  }
  await clearPackageEtag(meet);
  const refetched = await fetchApiMeetPackageConditional(meet, historyCutoffDate, null);
  if (refetched.status !== 'fresh') {
    throw new Error(`Unexpected 304 for ${meet} without a validator`);
  }
  return { ...refetched, replacesIngested: false };
}

export async function ingestMeetPackage(
  meet: MeetName,
  pkg: ApiMeetPackage,
  options: { findChanges: boolean } = { findChanges: false },
): Promise<{ rosterNames: string[]; changedNames: string[] | null }> {
  const schedule = mapPackageSchedule(pkg);
  const athletes = mapApiAthletes(pkg.athletes, '/meets/package');
  const athleteNames = uniqueAthleteNames(athletes);
  const liftingResults = pkg.meet_results.map(mapApiLiftingResult);
  const yearBests = packageYearBests(pkg);

  let changedNames: string[] | null = null;
  if (options.findChanges) {
    const [storedResults, storedBests] = await Promise.all([
      getMeetLiftingResults(meet),
      readPackageBestsSnapshot(meet),
    ]);
    if (storedBests) {
      changedNames = Array.from(
        namesWithChangedPackageData({ results: liftingResults, storedResults, yearBests, storedBests }),
      );
      if (!(await addPendingHistoryNames(meet, changedNames))) changedNames = null;
    }
  }

  if (schedule.length > 0) {
    await saveMeetSchedule(meet, schedule);
  }
  const rosterSaved = await saveMeetAthletes(meet, athletes);

  if (liftingResults.length > 0) {
    validatePrefetchedLiftingResults(meet, athleteNames, liftingResults);
    await saveMeetLiftingResults(meet, liftingResults);
  }

  await saveAthleteBestsBatch(yearBests);
  await writePackageBestsSnapshot(meet, yearBests);

  if (!rosterSaved) return { rosterNames: (await readLocalRosterNames(meet)) ?? [], changedNames };
  return { rosterNames: athleteNames, changedNames };
}
