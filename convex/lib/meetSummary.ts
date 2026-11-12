import { attemptCounts } from './attempts';
import type { Gender } from './gender';
import { parseDivision, plausible, rowQpoints, rowSinclair } from './leaderboard';
import { normalizeName } from './names';
import type { ApiLiftingResult } from './results';
import { compareBytes } from './sort';

export type ScoredLifter = { score: number; name: string };
export type BestByGender = { men: ScoredLifter | null; women: ScoredLifter | null };

export type EditionSummary = {
  meet: string;
  year: string;
  athletes: number;
  bomb_outs: number;
  average_total: number | null;
  make_rate: number | null;
  best_sinclair: BestByGender;
  best_qpoints: BestByGender;
};

const bitsOf = (value: number) => (Object.is(value, -0) ? '-0' : String(value));

function performanceKey(row: ApiLiftingResult): string {
  const lifts = [row.body_weight, row.snatch1, row.snatch2, row.snatch3, row.cj1, row.cj2, row.cj3].map(bitsOf);
  return JSON.stringify([normalizeName(row.name), row.date, lifts]);
}

export function onePerPerformance(rows: readonly ApiLiftingResult[]): ApiLiftingResult[] {
  const first = new Map<string, ApiLiftingResult>();
  for (const row of rows) {
    const key = performanceKey(row);
    if (!first.has(key)) first.set(key, row);
  }
  return [...first.values()];
}

export function bombedOut(row: ApiLiftingResult): boolean {
  return row.snatch_best <= 0 || row.cj_best <= 0 || row.total <= 0;
}

function attemptsOf(row: ApiLiftingResult): number[] {
  return [row.snatch1, row.snatch2, row.snatch3, row.cj1, row.cj2, row.cj3];
}

function makeRate(rows: readonly ApiLiftingResult[]): number | null {
  const { taken, made } = attemptCounts(rows.flatMap(attemptsOf));
  return taken > 0 ? (made * 100) / taken : null;
}

function averageTotal(rows: readonly ApiLiftingResult[]): number | null {
  const totals = rows.filter((row) => row.total > 0 && plausible(row)).map((row) => row.total);
  return totals.length > 0 ? totals.reduce((sum, total) => sum + total, 0) / totals.length : null;
}

function bestScoreOf(rows: readonly ApiLiftingResult[], score: (row: ApiLiftingResult) => number | null, gender: Gender): ScoredLifter | null {
  let best: ScoredLifter | null = null;
  for (const row of rows) {
    if (parseDivision(row.age).gender !== gender) continue;
    const value = score(row);
    if (value === null) continue;
    if (best === null || value >= best.score) best = { score: value, name: row.name };
  }
  return best;
}

function bestByGender(rows: readonly ApiLiftingResult[], score: (row: ApiLiftingResult) => number | null): BestByGender {
  return { men: bestScoreOf(rows, score, 'Men'), women: bestScoreOf(rows, score, 'Women') };
}

export function summarizeEdition(meet: string, year: string, rows: readonly ApiLiftingResult[]): EditionSummary {
  const performances = onePerPerformance(rows);
  return {
    meet,
    year,
    athletes: performances.length,
    bomb_outs: performances.filter(bombedOut).length,
    average_total: averageTotal(performances),
    make_rate: makeRate(performances),
    best_sinclair: bestByGender(rows, rowSinclair),
    best_qpoints: bestByGender(rows, rowQpoints),
  };
}

export function editionSummaries(meet: string, rows: readonly ApiLiftingResult[]): EditionSummary[] {
  const byYear = new Map<string, ApiLiftingResult[]>();
  for (const row of rows) {
    const year = row.date.slice(0, 4);
    const edition = byYear.get(year);
    if (edition) edition.push(row);
    else byYear.set(year, [row]);
  }
  return [...byYear.entries()].map(([year, edition]) => summarizeEdition(meet, year, edition));
}

export function newestEditionFirst(a: EditionSummary, b: EditionSummary): number {
  return compareBytes(b.year, a.year) || compareBytes(a.meet, b.meet);
}
