type Takeable<Row> = { take(count: number): Promise<Row[]> };

export async function readAll<Row>(rows: Takeable<Row>, limit: number, what: string): Promise<Row[]> {
  const read = await rows.take(limit + 1);
  if (read.length > limit) throw new Error(`more than ${limit} ${what}: this read is bounded (convex/lib/boundedRead.ts); raise its limit or page it`);
  return read;
}

export const MEET_RESULTS_MAX = 10_000;
export const EVENT_RESULTS_MAX = 10_000;
export const ATHLETE_RESULTS_MAX = 2_000;
export const DIVISION_YEAR_RESULTS_MAX = 30_000;
export const ADAPTIVE_SEASON_RESULTS_MAX = 10_000;
export const MEET_ROSTER_MAX = 10_000;
export const MEMBER_REGISTRATIONS_MAX = 1_000;
export const MEET_SESSIONS_MAX = 2_000;
export const MEETS_MAX = 5_000;
export const MEET_RESULT_TITLES_MAX = 200;
export const RECORDS_MAX = 10_000;
export const STANDARDS_MAX = 2_000;
export const QUALIFYING_TOTALS_MAX = 20_000;
export const INTL_RANKINGS_MAX = 10_000;
export const WSO_RECORDS_MAX = 20_000;
export const REFERENCE_TABLE_ROWS_MAX = 20_000;
export const VIEW_CHUNKS_MAX = 2_000;
export const VIEW_HEADERS_MAX = 20_000;
export const CRON_JOBS_MAX = 500;
export const ENTRY_TARGETS_MAX = 500;
export const NAME_RESULTS_MAX = 2_000;
export const LIFTERS_OF_NAME_MAX = 200;
export const NAMES_OF_LIFTER_MAX = 200;
