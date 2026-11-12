import { assertHasFields, assertStringArray } from '@/lib/api/api-validators';
import { readQuery } from '@/lib/api/meetcal-api';

export type ApiWrappedStats = {
  totalWeightLifted: number;
  totalMeets: number;
  makePercentage: number;
  bestSnatch: number;
  bestCleanJerk: number;
  bestTotal: number;
  averageTotal: number;
  topMeet: string | null;
  improvementFromFirst: number | null;
  longestMakeStreak: number;
  favoriteAttempt: 1 | 2 | 3 | null;
  yearRank: string;
};

export type ApiWrappedAnswer =
  | { kind: 'athlete'; name: string; stats: ApiWrappedStats }
  | { kind: 'ambiguous'; names: string[]; truncated: boolean }
  | { kind: 'narrow' }
  | { kind: 'tooManyResults'; name: string }
  | { kind: 'none'; suggestions: string[] };

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} expected a number`);
  return value;
}

function mapWrappedStats(value: unknown): ApiWrappedStats {
  const stats = assertHasFields(value, '/wrapped.stats', [
    'totalWeightLifted',
    'totalMeets',
    'makePercentage',
    'bestSnatch',
    'bestCleanJerk',
    'bestTotal',
    'averageTotal',
    'topMeet',
    'improvementFromFirst',
    'longestMakeStreak',
    'favoriteAttempt',
    'yearRank',
  ]);
  const num = (key: string) => finiteNumber(stats[key], `/wrapped.stats.${key}`);
  const favorite = stats.favoriteAttempt;
  if (favorite !== null && favorite !== 1 && favorite !== 2 && favorite !== 3) throw new Error('/wrapped.stats.favoriteAttempt expected 1, 2, 3 or null');
  if (stats.topMeet !== null && typeof stats.topMeet !== 'string') throw new Error('/wrapped.stats.topMeet expected a string or null');
  if (typeof stats.yearRank !== 'string') throw new Error('/wrapped.stats.yearRank expected a string');
  return {
    totalWeightLifted: num('totalWeightLifted'),
    totalMeets: num('totalMeets'),
    makePercentage: num('makePercentage'),
    bestSnatch: num('bestSnatch'),
    bestCleanJerk: num('bestCleanJerk'),
    bestTotal: num('bestTotal'),
    averageTotal: num('averageTotal'),
    topMeet: stats.topMeet,
    improvementFromFirst: stats.improvementFromFirst === null ? null : num('improvementFromFirst'),
    longestMakeStreak: num('longestMakeStreak'),
    favoriteAttempt: favorite,
    yearRank: stats.yearRank,
  };
}

export async function fetchWrapped(query: string, year: number, picked = false): Promise<ApiWrappedAnswer> {
  const answer = assertHasFields(await readQuery('/wrapped', 'results:wrapped', { query, year, picked: picked || undefined }), '/wrapped', ['kind']);
  switch (answer.kind) {
    case 'athlete':
      if (typeof answer.name !== 'string') throw new Error('/wrapped.name expected a string');
      return { kind: 'athlete', name: answer.name, stats: mapWrappedStats(answer.stats) };
    case 'ambiguous':
      return { kind: 'ambiguous', names: assertStringArray(answer.names, '/wrapped.names'), truncated: answer.truncated === true };
    case 'narrow':
      return { kind: 'narrow' };
    case 'tooManyResults':
      if (typeof answer.name !== 'string') throw new Error('/wrapped.name expected a string');
      return { kind: 'tooManyResults', name: answer.name };
    case 'none':
      return { kind: 'none', suggestions: answer.suggestions === undefined ? [] : assertStringArray(answer.suggestions, '/wrapped.suggestions') };
    default:
      throw new Error(`/wrapped returned an unknown kind ${JSON.stringify(answer.kind)}`);
  }
}
