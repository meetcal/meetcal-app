import type { ApiLiftingResult } from '../convex/lib/results';
import { exactSearchAnswer, fallbackSearchAnswer, MAX_SEARCH_RESULT_ROWS } from '../convex/results';

function row(name: string, date: string, total = 100): ApiLiftingResult {
  return {
    id: 0,
    event_id: `${name}|${date}`,
    federation: 'USAW',
    meet: `Meet ${date}`,
    date,
    name,
    age: 'Open Men',
    body_weight: 80,
    snatch1: 0,
    snatch2: 0,
    snatch3: 0,
    snatch_best: 0,
    cj1: 0,
    cj2: 0,
    cj3: 0,
    cj_best: 0,
    total,
    adaptive: false,
  };
}

/** A newest-first history of one result a day, `count` days from 2000-01-01. */
function dailyHistory(name: string, count: number): ApiLiftingResult[] {
  const rows: ApiLiftingResult[] = [];
  for (let i = 0; i < count; i++) {
    rows.push(row(name, new Date(Date.UTC(2000, 0, 1 + i)).toISOString().slice(0, 10)));
  }
  return rows.reverse();
}

describe('results:search date range', () => {
  const history = [row('Ann Lee', '2027-01-01'), row('Ann Lee', '2026-12-31'), row('Ann Lee', '2026-01-01'), row('Ann Lee', '2025-12-31')];

  it('includes both endpoints', () => {
    const answer = exactSearchAnswer('Ann Lee', history, '2026-01-01', '2026-12-31');
    expect(answer?.results.map((r) => r.date)).toEqual(['2026-01-01', '2026-12-31']);
    expect(answer).toMatchObject({ matched_name: 'Ann Lee', suggestions: [], truncated: false });
  });

  it('includes a one-day range', () => {
    const answer = fallbackSearchAnswer('ann', ['Ann Lee'], new Map([['ann lee', history]]), '2026-12-31', '2026-12-31');
    expect(answer.results.map((r) => r.date)).toEqual(['2026-12-31']);
  });

  it('answers null for an exact name without results in the range, so the fallback runs', () => {
    expect(exactSearchAnswer('Ann Lee', history, '2028-01-01', '2028-12-31')).toBeNull();
  });
});

describe('results:search row bound', () => {
  it('keeps the most recent rows of a fallback, oldest first, and says it cut some', () => {
    const histories = new Map([
      ['ann smith', dailyHistory('Ann Smith', 400)],
      ['bob smith', dailyHistory('Bob Smith', 400)],
    ]);
    const answer = fallbackSearchAnswer('smith', ['Ann Smith', 'Bob Smith'], histories, '1990-01-01', '2030-12-31');
    expect(answer.truncated).toBe(true);
    expect(answer.results).toHaveLength(MAX_SEARCH_RESULT_ROWS);
    const dates = answer.results.map((r) => r.date);
    expect(dates).toEqual([...dates].sort());
    // The newest day is kept; the 100 oldest days (both athletes) are not.
    expect(dates[dates.length - 1]).toBe('2001-02-03');
    expect(dates[0]).toBe('2000-04-10');
  });

  it('keeps the most recent rows of an exact match too', () => {
    const answer = exactSearchAnswer('Ann Smith', dailyHistory('Ann Smith', MAX_SEARCH_RESULT_ROWS + 5), '1990-01-01', '2030-12-31');
    expect(answer?.truncated).toBe(true);
    expect(answer?.results[0].date).toBe('2000-01-06');
  });

  it('is not truncated under the bound', () => {
    const answer = fallbackSearchAnswer('smith', ['Ann Smith'], new Map([['ann smith', dailyHistory('Ann Smith', 3)]]), '1990-01-01', '2030-12-31');
    expect(answer).toMatchObject({ truncated: false, suggestions: ['Ann Smith'] });
    expect(answer.results).toHaveLength(3);
  });

  it('is truncated when the name scan stopped at its limit, whatever the row count', () => {
    const names = Array.from({ length: 1000 }, (_, i) => `Smith ${i}`);
    const answer = fallbackSearchAnswer('smith', names, new Map(), '1990-01-01', '2030-12-31');
    expect(answer.truncated).toBe(true);
    expect(answer.suggestions).toHaveLength(8);
  });
});
