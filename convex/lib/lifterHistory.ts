import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { markOf, readHistories } from './history';
import { namesOfLifter } from './lifterCandidates';
import { newestSpelling } from './names';
import { prMarks, type PrMarks } from './prs';
import { bestsSince, ZERO_BESTS, type ApiLiftingResult, type YearBests } from './results';
import { compareBytes } from './sort';

export type LifterCard = { id: string; name: string; label: string };

export type LifterChoice = LifterCard & { results: number; latest_date: string };

export type AthleteResults = {
  kind: 'results';
  lifter: LifterCard | null;
  json: string;
  prs: PrMarks;
  year_bests: YearBests | null;
};

export type AthleteChoice = {
  kind: 'choose';
  name: string;
  lifters: LifterChoice[];
  other_results: number;
};

export type AthleteAnswer = AthleteResults | AthleteChoice;

type LabelFields = Pick<Doc<'lifters'>, 'birthYear' | 'wso' | 'club'>;

export function lifterLabel(lifter: LabelFields, year: number): string {
  const age = lifter.birthYear === undefined ? undefined : `Age ${year - lifter.birthYear}`;
  return [age, lifter.wso, lifter.club].filter((part): part is string => part !== undefined && part.trim() !== '').join(' · ');
}

export function lifterCard(id: string, lifter: Doc<'lifters'> | null, rows: readonly ApiLiftingResult[], year: number): LifterCard {
  return { id, name: lifter?.name ?? newestSpelling(rows) ?? '', label: lifter ? lifterLabel(lifter, year) : '' };
}

export function newestFirst(rows: ApiLiftingResult[]): ApiLiftingResult[] {
  return rows.sort((a, b) => compareBytes(b.date, a.date));
}

export function athleteResults(lifter: LifterCard | null, rows: readonly ApiLiftingResult[], cutoff: string | undefined): AthleteResults {
  return {
    kind: 'results',
    lifter,
    json: JSON.stringify(rows),
    prs: prMarks(rows),
    year_bests: cutoff === undefined ? null : (bestsSince(rows.map(markOf), cutoff) ?? ZERO_BESTS),
  };
}

export const unlinked = (row: ApiLiftingResult) => row.lifter_id === undefined;

export function rowsByLifter(history: readonly ApiLiftingResult[]): Map<string, ApiLiftingResult[]> {
  const byLifter = new Map<string, ApiLiftingResult[]>();
  for (const row of history) {
    if (row.lifter_id === undefined) continue;
    byLifter.set(row.lifter_id, [...(byLifter.get(row.lifter_id) ?? []), row]);
  }
  return byLifter;
}

export function choiceOf(card: LifterCard, rows: readonly ApiLiftingResult[]): LifterChoice {
  return { ...card, results: rows.length, latest_date: rows.reduce((latest, row) => (row.date > latest ? row.date : latest), '') };
}

export function choicesInOrder(choices: LifterChoice[]): LifterChoice[] {
  return choices.sort((a, b) => compareBytes(b.latest_date, a.latest_date) || b.results - a.results || compareBytes(a.id, b.id));
}

export async function lifterById(ctx: QueryCtx, athleteId: string): Promise<Doc<'lifters'> | null> {
  return await ctx.db
    .query('lifters')
    .withIndex('by_athleteId', (q) => q.eq('athleteId', athleteId))
    .unique();
}

export async function lifterOfMembership(ctx: QueryCtx, membership: string): Promise<string | null> {
  const entry = await ctx.db
    .query('lifter_memberships')
    .withIndex('by_membership', (q) => q.eq('membership', membership))
    .first();
  return entry?.athleteId ?? null;
}

export async function rowsOfLifter(ctx: QueryCtx, athleteId: string, nameKeys: readonly string[]): Promise<ApiLiftingResult[]> {
  const keys = [...new Set([...nameKeys, ...(await namesOfLifter(ctx, athleteId))])];
  const histories = await readHistories(ctx, keys);
  return newestFirst([...histories.values()].flat().filter((row) => row.lifter_id === athleteId));
}
