import { RecordsData } from '@/types/records';

/**
 * Narrow a records payload to one age group and/or one gender.
 *
 * Used when a filtered request falls back to the full offline cache, so the
 * screen still sees only the rows it asked for. `fetch-records` and
 * `fetch-wso-records` each carried an identical private copy.
 *
 * Omitting both arguments returns the input untouched.
 */
export function filterRecordsData(
  source: RecordsData,
  ageGroup?: string,
  gender?: 'Men' | 'Women',
): RecordsData {
  if (!ageGroup && !gender) return source;

  const result: RecordsData = {};
  const groups = ageGroup ? [ageGroup] : Object.keys(source);

  groups.forEach((group) => {
    const row = source[group];
    if (!row) return;
    result[group] = {
      Men: gender === 'Women' ? [] : row.Men,
      Women: gender === 'Men' ? [] : row.Women,
    };
  });

  return result;
}
