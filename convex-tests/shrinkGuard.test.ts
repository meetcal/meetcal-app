import { describeFailure } from '../convex/lib/cronAlerts';
import { clearedColumns, clearedLifts, exceedsShrink, liftCount, MAX_SHRINK_SHARE, MIN_SHRINK_ALLOWED } from '../convex/lib/shrinkGuard';
import { targetExpired, TARGET_RETENTION_DAYS } from '../convex/scrapers/entries';
import { joinPages, MAX_UNREADABLE_SHARE, run as sport80Run, tableComplete, tooManyUnreadable } from '../convex/scrapers/sport80';
import { recordLift } from '../convex/scrapers/parse/holder';
import { handlerOf } from './fakeDb';

describe('shrink guard', () => {
  it('always allows the minimum, then a share of what is stored', () => {
    expect(exceedsShrink(MIN_SHRINK_ALLOWED, 0)).toBe(false);
    expect(exceedsShrink(MIN_SHRINK_ALLOWED + 1, 40)).toBe(true);
    expect(exceedsShrink(25, 100 / MAX_SHRINK_SHARE)).toBe(false);
    expect(exceedsShrink(3, 8, { share: 0.25, min: 2 })).toBe(true);
    expect(exceedsShrink(2, 8, { share: 0.25, min: 2 })).toBe(false);
  });

  it('counts lifts that go from a value to none', () => {
    expect(liftCount({ snatchRecord: 100, totalRecord: 220 })).toBe(2);
    expect(clearedLifts({ snatchRecord: 100, cjRecord: 120, totalRecord: 220 }, { snatchRecord: 101 })).toBe(2);
    expect(clearedLifts({}, {})).toBe(0);
  });
});

describe('result columns emptied (#96)', () => {
  const row = { bodyWeight: 80, snatch1: 100, snatchBest: 100, cj1: 120, cjBest: 120, total: 220 };

  it('flags a column emptied on most stored rows, not a few corrections', () => {
    const renamed = Array.from({ length: 20 }, () => ({ stored: row, next: { ...row, total: undefined } }));
    expect(clearedColumns(renamed)).toEqual(['total']);
    const corrected = renamed.map((update, i) => (i < 3 ? update : { stored: row, next: row }));
    expect(clearedColumns(corrected)).toEqual([]);
    // A column no stored row had is never "emptied".
    expect(clearedColumns([{ stored: {}, next: {} }])).toEqual([]);
  });

  it('takes a table as read only when it has the rows its total reports', () => {
    expect(tableComplete(29, 29)).toBe(true);
    expect(tableComplete(28, 29)).toBe(false);
    expect(tableComplete(0, 0)).toBe(true);
    // No reported count proves nothing.
    expect(tableComplete(29, undefined)).toBe(false);
    expect(tableComplete(29, '29')).toBe(false);
    expect(tableComplete(29, 29.5)).toBe(false);
  });

  it('joins pages, refusing a short table and flagging one no basis for a prune', () => {
    const alice = { lifter: 'Alice', total: 200 };
    const bob = { lifter: 'Bob', total: 210 };
    expect(joinPages([[alice], [bob]], 2)).toEqual({ rows: [alice, bob] });
    expect(() => joinPages([[alice]], 2)).toThrow('read 1 rows of the 2 the table reports');
    // A partial table that reports no total still stores, but is not whole.
    expect(joinPages([[alice]], undefined)).toEqual({ rows: [alice], notWhole: 'the table reports no row count' });
    // Alice on both pages and Bob on none: the count matches, the table is not whole.
    expect(joinPages([[alice], [{ ...alice }]], 2).notWhole).toBe('a row came back on two pages (their order shifted)');
    // Rows of one athlete that differ (two divisions) are not a repeat.
    expect(joinPages([[alice], [{ ...alice, total: 190 }]], 2).notWhole).toBeUndefined();
  });
});

describe('record lift cells (#91)', () => {
  it('reads numbers, reads empty markers as none, and throws on anything else', () => {
    expect(recordLift(' 102 ')).toBe(102);
    expect(recordLift('128.5')).toBe(128);
    for (const empty of ['', ' - ', '—', 'n/a', '#N/A', 'TBD', 'Vacant', 'open', 'Standard', 'WSO Standard']) expect(recordLift(empty)).toBeNull();
    for (const bad of ['102 kg', '125*', 'x', 'Jane']) expect(() => recordLift(bad)).toThrow(`unreadable lift value ${JSON.stringify(bad)}`);
  });
});

describe('Sport80 unreadable rows (#96)', () => {
  it('skips a stray row quietly and fails a meet whose payload changed', () => {
    expect(tooManyUnreadable(0, 0)).toBe(false);
    expect(tooManyUnreadable(1, 100)).toBe(false);
    expect(tooManyUnreadable(100 * MAX_UNREADABLE_SHARE, 100)).toBe(false);
    expect(tooManyUnreadable(100 * MAX_UNREADABLE_SHARE + 1, 100)).toBe(true);
    expect(tooManyUnreadable(3, 3)).toBe(true);
    expect(tooManyUnreadable(1, 1)).toBe(true);
  });
});

describe('entries targets of completed meets (#167)', () => {
  const now = Date.parse('2026-10-11T12:00:00Z');

  it('keeps a target for the retention after its meet ends, then lets it go', () => {
    expect(TARGET_RETENTION_DAYS).toBe(14);
    expect(targetExpired('2026-10-10', now)).toBe(false);
    expect(targetExpired('2026-09-27', now)).toBe(false);
    expect(targetExpired('2026-09-26', now)).toBe(true);
    expect(targetExpired('2025-06-01', now)).toBe(true);
    // A missing or malformed end date keeps the target (skipped, not removed).
    expect(targetExpired('', now)).toBe(false);
    expect(targetExpired('June 1, 2025', now)).toBe(false);
  });
});

describe('Sport80 sync prunes only a table read in full (#97)', () => {
  const event = { action: [{ route: '/public/rankings/results/123' }], meet: 'Test Open', date: '2026-10-01' };
  const results = [
    { lifter: 'Alice', total: 200 },
    { lifter: 'Bob', total: 210 },
  ];

  /** A fake Sport80: the rankings page's `window.env`, one event, and its results table. */
  const sport80 = (table: Record<string, unknown>) =>
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/public/rankings/')) return new Response('window.env = {"SERVICES_API_PUBLIC_KEY":"k","RANKINGS_DOMAIN_URL":"https://api.test"};');
      if (url.includes('/api/events/table/data')) return Response.json({ data: [event], total: 1 });
      if (url.includes('/api/events/123/table/data')) return Response.json(table);
      throw new Error(`unexpected fetch ${url}`);
    });
  const ctx = () => ({
    runMutation: jest.fn(async (_fn: unknown, args: Record<string, unknown>) =>
      'keep' in args ? { deleted: 0, remaining: 0 } : { inserted: 2, updated: 0, unchanged: 0 },
    ),
  });
  const pruneCalls = (c: ReturnType<typeof ctx>) => c.runMutation.mock.calls.filter(([, args]) => 'keep' in args);

  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it('prunes a table with the rows its total reports', async () => {
    sport80({ data: results, total: 2 });
    const c = ctx();
    await handlerOf<Record<string, never>, unknown>(sport80Run)(c, {});
    expect(pruneCalls(c)).toHaveLength(1);
  });

  it('stores a table that reports no total, but does not prune against it, and fails the run', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    sport80({ data: results.slice(0, 1) });
    const c = ctx();
    await expect(handlerOf<Record<string, never>, unknown>(sport80Run)(c, {})).rejects.toThrow('stale results not deleted: the table reports no row count');
    expect(c.runMutation).toHaveBeenCalled();
    expect(pruneCalls(c)).toHaveLength(0);
  });

  describe('the override for one event (#265)', () => {
    type Only = { only: string[]; allowShrink?: boolean };
    beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));

    it('syncs and prunes the event it names', async () => {
      sport80({ data: results, total: 2 });
      const c = ctx();
      await handlerOf<Only, unknown>(sport80Run)(c, { only: ['123'], allowShrink: true });
      expect(pruneCalls(c)).toHaveLength(1);
      expect(pruneCalls(c)[0][1]).toMatchObject({ eventId: '123', allowShrink: true });
    });

    it('fails naming an id the event index does not have, instead of finishing as if done', async () => {
      sport80({ data: results, total: 2 });
      const c = ctx();
      const failure = await handlerOf<Only, unknown>(sport80Run)(c, { only: ['999'] }).catch((error: unknown) => error);
      expect(describeFailure(failure)).toMatchObject({ failedSources: ['event 999'], error: expect.stringContaining('not in the event index read') });
      expect(c.runMutation).not.toHaveBeenCalled();
    });

    it('fails naming an event it found but read no results for', async () => {
      sport80({ data: [], total: 0 });
      const c = ctx();
      const failure = await handlerOf<Only, unknown>(sport80Run)(c, { only: ['123'] }).catch((error: unknown) => error);
      expect(describeFailure(failure)).toMatchObject({ failedSources: ['event 123'], error: expect.stringContaining('no results read') });
    });
  });
});
