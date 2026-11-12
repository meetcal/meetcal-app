import { normalizeAthleteName } from '@/lib/athletes';
import { AthleteMeetResult } from '@/data/types/athletes';
import { ATTEMPT_HISTORY_YEARS, getHistoryCutoffDate, YEAR_BESTS_YEARS } from '@/utils/dateTime';
import { assertArray, assertHasFields, assertStringArray } from '@/lib/api/api-validators';
import { decodeJsonText, readQuery } from '@/lib/api/meetcal-api';
import { mapApiLiftingResult, mapApiYearBests, parseNamedBests } from '@/lib/api/api-athlete-mappers';

export const NAMES_QUERY_CHUNK_SIZE = 40;

export const SMALL_ROWS_NAMES_CHUNK_SIZE = 100;

function chunkValues<T>(values: T[], size: number): T[][] {
  if (values.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

export type ResultsByNamesOptions = {
  latestOnly?: boolean;
};

export async function fetchApiResultsByNames(
  names: string[],
  options: ResultsByNamesOptions = {},
): Promise<AthleteMeetResult[]> {
  if (names.length === 0) return [];
  const rows: AthleteMeetResult[] = [];
  const chunkSize = options.latestOnly ? SMALL_ROWS_NAMES_CHUNK_SIZE : NAMES_QUERY_CHUNK_SIZE;
  for (const chunk of chunkValues(names, chunkSize)) {
    const part = assertArray(
      decodeJsonText(
        await readQuery('/lifting-results/by-names', 'results:byNames', {
          names: chunk,
          latestOnly: options.latestOnly ? true : undefined,
        }),
        '/lifting-results/by-names',
      ),
      '/lifting-results/by-names',
    );
    rows.push(...part.map(mapApiLiftingResult));
  }
  return rows;
}

export async function fetchApiRecentResultsByNames(
  names: string[],
  cutoffDate: string = getHistoryCutoffDate(ATTEMPT_HISTORY_YEARS),
): Promise<AthleteMeetResult[]> {
  if (names.length === 0) return [];
  const rows: AthleteMeetResult[] = [];
  for (const chunk of chunkValues(names, NAMES_QUERY_CHUNK_SIZE)) {
    const part = assertArray(
      decodeJsonText(
        await readQuery('/lifting-results/recent', 'results:recent', { names: chunk, cutoffDate }),
        '/lifting-results/recent',
      ),
      '/lifting-results/recent',
    );
    rows.push(...part.map(mapApiLiftingResult));
  }
  return rows;
}

export type YearBestsOptions = { latestWhenEmpty?: boolean };

export async function fetchApiYearBestsByNames(
  names: string[],
  cutoffDate: string = getHistoryCutoffDate(YEAR_BESTS_YEARS),
  { latestWhenEmpty = false }: YearBestsOptions = {},
): Promise<Record<string, ReturnType<typeof mapApiYearBests>>> {
  if (names.length === 0) return {};
  const byFoldedName = new Map<string, ReturnType<typeof mapApiYearBests>>();
  for (const chunk of chunkValues(names, SMALL_ROWS_NAMES_CHUNK_SIZE)) {
    const rows = assertArray(
      await readQuery('/lifting-results/bests', 'results:bests', {
        names: chunk,
        cutoffDate,
        latestWhenEmpty: latestWhenEmpty || undefined,
      }),
      '/lifting-results/bests',
    );
    for (const { name, bests } of parseNamedBests(rows, '/lifting-results/bests')) {
      byFoldedName.set(normalizeAthleteName(name), mapApiYearBests(bests));
    }
  }
  const byName: Record<string, ReturnType<typeof mapApiYearBests>> = {};
  for (const name of names) {
    const bests = byFoldedName.get(normalizeAthleteName(name));
    if (bests) byName[name] = bests;
  }
  return byName;
}

export async function searchApi(query: string, startDate?: string, endDate?: string) {
  const response = assertHasFields(
    await readQuery('/search', 'results:search', { query, startDate, endDate }),
    '/search',
    ['matched_name', 'suggestions', 'results'],
  );
  const suggestions = assertStringArray(response.suggestions, '/search.suggestions');
  const results = assertArray(response.results, '/search.results');
  return {
    matchedName: typeof response.matched_name === 'string' ? response.matched_name : null,
    suggestions,
    results: results.map(mapApiLiftingResult),
    truncated: response.truncated === true,
  };
}
