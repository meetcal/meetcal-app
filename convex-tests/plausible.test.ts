import { isPlausibleResult, resultProblems } from '../convex/lib/plausible';

describe('resultProblems', () => {
  it('accepts real results, bomb-outs and rows with only a total', () => {
    expect(resultProblems({ snatch1: 100, snatch2: -105, snatch3: 105, snatchBest: 105, cj1: 130, cj2: 135, cj3: -140, cjBest: 135, total: 240 })).toEqual([]);
    expect(resultProblems({ snatch1: -100, snatch2: -100, snatch3: -100, snatchBest: 0, cj1: 130, cjBest: 130, total: 0 })).toEqual([]);
    expect(resultProblems({ total: 300 })).toEqual([]);
    expect(resultProblems({})).toEqual([]);
    // A big real jump at light weights: under JUMP_MIN_KG.
    expect(isPlausibleResult({ snatch1: 10, snatch2: 16, snatchBest: 16, cj1: 14, cjBest: 14, total: 30 })).toBe(true);
    // Rounding in a decimal total.
    expect(isPlausibleResult({ snatchBest: 52.5, cjBest: 70, total: 122.5 })).toBe(true);
  });

  it('finds a ten-times typo, a total that is not the sum, and lifts over the records', () => {
    expect(resultProblems({ snatch1: -63, snatch2: 633, snatch3: 65, snatchBest: 633, cj1: 83, cj2: 86, cj3: 90, cjBest: 90, total: 723 })).toEqual([
      'snatch 633 is over 240',
      'snatch attempt 633 against 65 (a typo?)',
      'total 723 is over 520',
    ]);
    expect(resultProblems({ cj1: 223, cj2: 27, cj3: -30, cjBest: 223, snatchBest: 21, total: 244 })).toEqual(['clean & jerk attempt 223 against 30 (a typo?)']);
    expect(resultProblems({ snatchBest: 137, cjBest: 176, total: 307 })).toEqual(['total 307 is not snatch 137 + clean & jerk 176']);
    expect(resultProblems({ snatchBest: 0, cjBest: 90, total: 90 })).toEqual(['total 90 is not snatch 0 + clean & jerk 90']);
    expect(isPlausibleResult({ total: 1184 })).toBe(false);
  });
});
