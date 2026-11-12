import type { AthleteMeetResult } from '@/data/types/athletes';
import { normalizeAthleteName } from '@/lib/athletes';

type ApiBests = { bestSnatch: number; bestCJ: number; bestTotal: number };
type WindowLookup = (names: string[], cutoffDate?: string) => Promise<Record<string, ApiBests | undefined>>;
type LatestRowsLookup = (names: string[], options: { latestOnly: true }) => Promise<AthleteMeetResult[]>;

const ZERO: ApiBests = { bestSnatch: 0, bestCJ: 0, bestTotal: 0 };

function heaviest(values: readonly (number | null | undefined)[]): number {
  return Math.max(0, ...values.map((value) => (typeof value === 'number' ? value : 0)));
}

export function serverLatestMeetBests(rows: readonly AthleteMeetResult[]): ApiBests {
  if (rows.length === 0) return ZERO;
  const newest = rows.reduce((latest, row) => ((row.date ?? '') > latest ? row.date ?? '' : latest), '');
  const latest = rows.filter((row) => (row.date ?? '') === newest);
  return {
    bestSnatch: heaviest(latest.flatMap((row) => [row.snatch_best, row.snatch1, row.snatch2, row.snatch3])),
    bestCJ: heaviest(latest.flatMap((row) => [row.cj_best, row.cj1, row.cj2, row.cj3])),
    bestTotal: heaviest(latest.map((row) => row.total)),
  };
}

function hasBest(bests: ApiBests | undefined): boolean {
  return !!bests && (bests.bestSnatch > 0 || bests.bestCJ > 0 || bests.bestTotal > 0);
}

export async function answerBestsOrLatest(
  names: string[],
  cutoffDate: string | undefined,
  options: { latestWhenEmpty?: boolean } | undefined,
  windowLookup: WindowLookup,
  latestRowsLookup: LatestRowsLookup,
): Promise<Record<string, ApiBests>> {
  const window = await windowLookup(names, cutoffDate);
  const answer: Record<string, ApiBests> = {};
  for (const [name, bests] of Object.entries(window)) if (bests) answer[name] = bests;
  if (!options?.latestWhenEmpty) return answer;
  const empty = names.filter((name) => !hasBest(window[name]));
  if (empty.length === 0) return answer;
  const rows = await latestRowsLookup(empty, { latestOnly: true });
  const byName = new Map<string, AthleteMeetResult[]>();
  for (const row of rows) {
    const key = normalizeAthleteName(row.name);
    byName.set(key, [...(byName.get(key) ?? []), row]);
  }
  for (const name of empty) answer[name] = serverLatestMeetBests(byName.get(normalizeAthleteName(name)) ?? []);
  return answer;
}
