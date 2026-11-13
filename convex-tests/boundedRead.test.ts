import * as limits from '../convex/lib/boundedRead';
import { readAll } from '../convex/lib/boundedRead';
import { DOCUMENTS_ONE_QUERY_MAY_READ } from '../convex/lib/readBudget';
import { MAX_SAVED_SESSIONS_PER_USER, USER_SAVED_SESSIONS_MAX } from '../convex/users';
import { changedFields, completeRecord, groupOf, isListOf, isPairOf, isString, isStringList, itemAt, last, parsedAs, textOrNull, typedKeys } from '../convex/lib/json';
import { readCompactRow } from '../convex/lib/leaderboard';
import { queuedNotices } from '../convex/lib/cronAlerts';
import { readTimelinesView } from '../convex/lib/meetData';
import { readStatsViewItems } from '../convex/lib/clubStats';

const rowsOf = (count: number) => ({ take: async (wanted: number) => Array.from({ length: Math.min(count, wanted) }, (_, index) => index) });

describe('reads that used to collect are bounded', () => {
  it('answers every row up to the limit, the limit included', async () => {
    expect(await readAll(rowsOf(0), 3, 'rows')).toEqual([]);
    expect(await readAll(rowsOf(3), 3, 'rows')).toEqual([0, 1, 2]);
  });

  it('fails, naming what it read and the limit, instead of answering a cut list', async () => {
    await expect(readAll(rowsOf(4), 3, 'results of one meet')).rejects.toThrow('more than 3 results of one meet');
  });

  it('reads one row past the limit and no more, so it can tell full from cut', async () => {
    const take = jest.fn(async (wanted: number) => Array.from({ length: wanted }, () => 0));
    await expect(readAll({ take }, 10, 'rows')).rejects.toThrow();
    expect(take).toHaveBeenCalledWith(11);
  });

  const MOST_STORED_ON_2026_11_11: Record<string, number> = {
    MEET_RESULTS_MAX: 1492,
    EVENT_RESULTS_MAX: 1492,
    ATHLETE_RESULTS_MAX: 93,
    ADAPTIVE_SEASON_RESULTS_MAX: 500,
    MEET_ROSTER_MAX: 1406,
    MEMBER_REGISTRATIONS_MAX: 3,
    MEET_SESSIONS_MAX: 123,
    MEETS_MAX: 72,
    MEET_RESULT_TITLES_MAX: 0,
    RECORDS_MAX: 807,
    STANDARDS_MAX: 64,
    QUALIFYING_TOTALS_MAX: 3838,
    INTL_RANKINGS_MAX: 74,
    WSO_RECORDS_MAX: 4780,
    REFERENCE_TABLE_ROWS_MAX: 4780,
    VIEW_CHUNKS_MAX: 2,
    VIEW_HEADERS_MAX: 3449,
    CRON_JOBS_MAX: 18,
    ENTRY_TARGETS_MAX: 7,
    DIVISION_YEAR_RESULTS_MAX: 14295,
  };
  const MOST_STORED_ON_2026_11_12: Record<string, number> = {
    NAME_RESULTS_MAX: 93,
    LIFTERS_OF_NAME_MAX: 7,
    NAMES_OF_LIFTER_MAX: 0,
  };
  const MOST_STORED: Record<string, number> = { ...MOST_STORED_ON_2026_11_11, ...MOST_STORED_ON_2026_11_12 };
  const ROOM_FOR_A_QUERY_S_OTHER_READS = 2_000;

  it('gives every limit four times the most rows stored when it was set, or all one query may read when that is less, and keeps under it', () => {
    const named = Object.entries(limits).flatMap(([name, value]): [string, number][] => (typeof value === 'number' ? [[name, value]] : []));
    expect(named.map(([name]) => name).sort()).toEqual(Object.keys(MOST_STORED).sort());
    for (const [name, limit] of named) {
      const room = limit >= Math.min(4 * (MOST_STORED[name] ?? Infinity), DOCUMENTS_ONE_QUERY_MAY_READ - ROOM_FOR_A_QUERY_S_OTHER_READS);
      expect([name, room]).toEqual([name, true]);
      expect([name, limit < DOCUMENTS_ONE_QUERY_MAY_READ]).toEqual([name, true]);
    }
  });
});

describe('reads bounded by a cap the write path keeps', () => {
  it('read at least as many rows as the write path lets one owner keep', () => {
    expect(USER_SAVED_SESSIONS_MAX).toBeGreaterThanOrEqual(MAX_SAVED_SESSIONS_PER_USER);
  });
});

describe('values are narrowed where they are read', () => {
  it('reads stored JSON only in the shape asked for', () => {
    expect(parsedAs('["a","b"]', isStringList, 'names')).toEqual(['a', 'b']);
    expect(() => parsedAs('["a",1]', isStringList, 'names')).toThrow('names is not stored in the shape it is read in');
    expect(parsedAs('[["a",["b"]]]', isListOf(isPairOf(isString, isStringList)), 'spellings')).toEqual([['a', ['b']]]);
    expect(() => parsedAs('[["a","b","c"]]', isListOf(isPairOf(isString, isString)), 'pairs')).toThrow();
  });

  it('reads an item by position or fails, never answering nothing', () => {
    expect(itemAt(['a', 'b'], 1)).toBe('b');
    expect(last(['a', 'b'])).toBe('b');
    expect(() => itemAt(['a'], 1)).toThrow('no item 1 in a list of 1');
    expect(() => itemAt(['a'], -1)).toThrow();
    expect(() => last([])).toThrow();
    expect(groupOf(/(a)(b)?/.exec('a')!, 2)).toBe('');
  });

  it('builds a record with every key, lists an object\'s own keys, and names the fields that changed', () => {
    expect(completeRecord(['men', 'women'] as const, (key) => key.length)).toEqual({ men: 3, women: 5 });
    expect(typedKeys({ b: 1, a: 2 })).toEqual(['b', 'a']);
    expect(changedFields({ name: 'A', city: 'X', zip: undefined }, { name: 'A', city: 'Y', zip: '1' })).toEqual({ city: 'X', zip: undefined });
    expect([textOrNull('a'), textOrNull(null), textOrNull(undefined), textOrNull(12)]).toEqual(['a', null, null, '12']);
  });

  it('reads a compact result row, a missing number as not a number, and refuses a row that is not one', () => {
    const row = ['USAW', 'Meet', '2026-01-01', 'A Lifter', "Open Men's 89kg", 88.5, 100, 105, -110, 105, 130, 135, 0, 135, 240, false, '30001', ''];
    expect(readCompactRow(row)).toEqual(row);
    const withNull = readCompactRow([...row.slice(0, 14), null, true, '', '30002']);
    expect([Number.isNaN(withNull[14]), withNull[15]]).toEqual([true, true]);
    expect(() => readCompactRow(row.slice(1))).toThrow('not a compact row');
    expect(() => readCompactRow([1, ...row.slice(1)])).toThrow('not a compact row');
  });

  it('refuses a queued notice of a kind it does not know', () => {
    expect(queuedNotices('entries', [{ kind: 'failed', detail: 'x' }])).toEqual([{ job: 'entries', kind: 'failed', detail: 'x' }]);
    expect(queuedNotices('entries', undefined)).toEqual([]);
    expect(() => queuedNotices('entries', [{ kind: 'exploded', detail: 'x' }])).toThrow('unknown kind "exploded"');
  });

  it('reads the timelines and stats views back, and refuses another shape', () => {
    expect(readTimelinesView([['names', ['A']], ['a', [['2026-01-01', 100, 120, 220]]]])).toEqual({ names: ['A'], timelines: [['a', [['2026-01-01', 100, 120, 220]]]] });
    expect(() => readTimelinesView([['a', []]])).toThrow();
    expect(() => readTimelinesView([['names', ['A']], ['a', [['2026-01-01', '100', 120, 220]]]])).toThrow();
    const stats = { key: 'a', name: 'A', club: 'C' };
    expect(readStatsViewItems([['club_counts', [['C', 2]]], stats])).toEqual({ rows: [stats], club_counts: [['C', 2]] });
    expect(readStatsViewItems([{ rows: [stats], club_counts: [['C', 2]] }])).toEqual({ rows: [stats], club_counts: [['C', 2]] });
    expect(() => readStatsViewItems([['club_counts', [['C', '2']]], stats])).toThrow('malformed stats view');
  });
});
