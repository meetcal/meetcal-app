import type { SourceTable } from './views';

/**
 * Every materialized view, by key, with the source tables it is built from.
 * Keys are `family|part|part`; the parts are data (meet names, age labels),
 * compared exactly.
 */

export const natKey = (federation: string, ageCategory: string) => `nat|${federation}|${ageCategory}`;

/**
 * Per-meet views, each the exact JSON of one answer (or of one package
 * section): `package_static` (the package up to its year bests, as text:
 * `{"meet":…,"schedule":…,"athletes":…,"meet_results":…` without the closing
 * brace), `schedule` (`/meets/schedule`), `sessions` (`/meets/athletes-sessions`
 * unfiltered), `athletes` (`/meets/athletes`), `timelines` (year bests
 * input), `stats` (club meet stats input) and `keys` (the roster's folded
 * names, for refresh).
 */
export type MeetViewPart =
  | 'package_static'
  | 'schedule'
  | 'sessions'
  | 'athletes'
  | 'timelines'
  | 'stats'
  | 'keys';
export const MEET_VIEW_PARTS: readonly MeetViewPart[] = [
  'package_static',
  'schedule',
  'sessions',
  'athletes',
  'timelines',
  'stats',
  'keys',
];
export const meetKey = (meet: string, part: MeetViewPart) => `meet|${meet}|${part}`;
/** One session's start list (`/meets/athletes-sessions?session_number=`), all platforms. */
export const meetSessionKey = (meet: string, sessionNumber: number) => `meet|${meet}|session|${sessionNumber}`;
export const meetSessionPrefix = (meet: string) => `meet|${meet}|session|`;

export const REF_VIEWS = {
  records: 'ref|records',
  standards: 'ref|standards',
  qualifying_totals: 'ref|qualifying_totals',
  intl_rankings: 'ref|intl_rankings',
  clubs: 'ref|clubs',
  wso_list: 'ref|wso_list',
} as const;

export const wsoKey = (wso: string) => `wso|${wso}`;
export const adaptiveKey = (gender: string, excludeFederation: string, season: string) =>
  `adaptive|${gender.toLowerCase()}|${excludeFederation}|${season}`;

/** The search directory; served whatever its age (see `results:search`). */
export const RESULT_NAMES_VIEW = 'search|names';
/** The search directory's two-letter shards (`lib/directory.ts`) and their sizes. */
export const SEARCH_SHARD_PREFIX = 'search|bigram|';
export const searchShardKey = (bigram: string) => `${SEARCH_SHARD_PREFIX}${encodeURIComponent(bigram)}`;
export const SEARCH_SHARD_SIZES_VIEW = 'search|bigram-sizes';

export const VIEW_SOURCES = {
  nat: ['lifting_results'],
  meetPackage: ['meets', 'athletes', 'session_schedule', 'lifting_results'],
  meetSchedule: ['session_schedule'],
  meetRoster: ['athletes', 'session_schedule'],
  meetAthletes: ['athletes'],
  meetTimelines: ['athletes', 'lifting_results'],
  meetStats: ['athletes', 'lifting_results'],
  meetKeys: ['athletes'],
  records: ['records'],
  standards: ['standards'],
  qualifying_totals: ['qualifying_totals'],
  intl_rankings: ['intl_rankings'],
  clubs: ['athletes'],
  wso: ['wso_records'],
  adaptive: ['lifting_results'],
} as const satisfies Record<string, readonly SourceTable[]>;

export const MEET_PART_SOURCES: Record<MeetViewPart, readonly SourceTable[]> = {
  package_static: VIEW_SOURCES.meetPackage,
  schedule: VIEW_SOURCES.meetSchedule,
  sessions: VIEW_SOURCES.meetRoster,
  athletes: VIEW_SOURCES.meetAthletes,
  timelines: VIEW_SOURCES.meetTimelines,
  stats: VIEW_SOURCES.meetStats,
  keys: VIEW_SOURCES.meetKeys,
};

/** Adaptive-record argument sets the app sends; other sets are computed live. */
export const ADAPTIVE_VIEW_ARGS = [
  { gender: 'men', excludeFederation: 'BWL' },
  { gender: 'women', excludeFederation: 'BWL' },
] as const;
