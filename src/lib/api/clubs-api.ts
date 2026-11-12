import { isRecord } from '@/lib/is-record';
import { copiedList, freshValue, revalidateTagged, type TaggedAnswer } from '@/lib/api/revalidated-reads';
import { assertArray, assertObject, nullableString, validateStringList } from '@/lib/api/api-validators';
import { readQuery } from '@/lib/api/meetcal-api';

export async function fetchApiClubNamesTagged(knownTag: string | null): Promise<TaggedAnswer<string[]>> {
  return copiedList(
    await revalidateTagged('/clubs', 'reference:clubs', {}, (json) => validateStringList(json, '/clubs'), { knownTag }),
  );
}

export async function fetchApiClubNames(): Promise<string[]> {
  return freshValue(await fetchApiClubNamesTagged(null), '/clubs');
}

export type ApiClubMeet = {
  meet: string;
  date: string | null;
};

export async function fetchApiClubMeets(club: string): Promise<ApiClubMeet[]> {
  const response = await readQuery('/clubs/meets', 'reference:clubMeets', { club });
  assertObject(response, '/clubs/meets');
  const rows = assertArray(response.meets, '/clubs/meets');
  const meets: ApiClubMeet[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const { meet, date } = row;
    if (typeof meet !== 'string' || meet.length === 0) continue;
    meets.push({ meet, date: nullableString(date) });
  }
  if (meets.length !== rows.length) {
    console.warn(`[api] /clubs/meets: dropped ${rows.length - meets.length} of ${rows.length} malformed meets`);
  }
  if (response.truncated === true && typeof __DEV__ !== 'undefined' && __DEV__) {
    console.info('[api] /clubs/meets: the server listed only the most recent meets', { club, meets: meets.length });
  }
  return meets;
}

export async function fetchApiClubMeetStats(club: string, meet: string): Promise<Record<string, unknown>> {
  const response = await readQuery('/clubs/meet-stats', 'reference:clubMeetStats', { club, meet });
  assertObject(response, '/clubs/meet-stats');
  return response;
}
