import { normalizeName } from '../convex/lib/names';
import { sport80Diff, type PublishedBase } from '../convex/lib/scheduleBuilder';

jest.mock('../convex/lib/names', () => {
  const actual = jest.requireActual('../convex/lib/names');
  return { ...actual, normalizeName: jest.fn(actual.normalizeName) };
});

const LIFTERS = 3000;

const lifter = (i: number, memberId: string) => ({ memberId, name: `Lifter Number ${i}`, age: 30, club: 'Club', gender: i % 2 === 0 ? 'Women' : 'Men', weightClass: '73', entryTotal: 100 + i });

describe("comparing a meet's start list with Sport80", () => {
  it('folds each name once, however long both lists are', () => {
    const roster = Array.from({ length: LIFTERS }, (_, i) => ({ ...lifter(i, String(10_000 + i)), _id: `row_${i}`, adaptive: false, sessionNumber: 1 + (i % 20), sessionPlatform: 'Red' }));
    const stillListed = Array.from({ length: LIFTERS / 2 }, (_, i) => lifter(i, String(10_000 + i)));
    const unnumbered = Array.from({ length: LIFTERS / 4 }, (_, i) => lifter(LIFTERS / 2 + i, 'noid:lifter'));
    const newcomers = Array.from({ length: LIFTERS / 4 }, (_, i) => lifter(LIFTERS + i, String(90_000 + i)));
    const base: PublishedBase = { rows: [], roster, sport80: [...stillListed, ...unnumbered, ...newcomers] };
    const folds = jest.mocked(normalizeName);
    folds.mockClear();
    const diff = sport80Diff(base);
    expect(folds.mock.calls.length).toBe(roster.length + (base.sport80?.length ?? 0));
    expect(diff.added).toHaveLength(LIFTERS / 4);
    expect(diff.withdrawnIds.size).toBe(LIFTERS / 4);
  });
});
