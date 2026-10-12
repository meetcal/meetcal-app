import { clearedColumns, clearedLifts, exceedsShrink, liftCount, MAX_SHRINK_SHARE, MIN_SHRINK_ALLOWED } from '../convex/lib/shrinkGuard';
import { targetExpired, TARGET_RETENTION_DAYS } from '../convex/scrapers/entries';
import { MAX_UNREADABLE_SHARE, tableComplete, tooManyUnreadable } from '../convex/scrapers/sport80';
import { recordLift } from '../convex/scrapers/parse/holder';

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
    expect(tableComplete(29, undefined)).toBe(true);
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
