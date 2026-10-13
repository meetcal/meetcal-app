import type { SourceTable } from './views';

/**
 * Every materialized view, by key, with the source tables it is built from.
 * Keys are `family|part|part`; the parts are data (meet names, age labels),
 * compared exactly, each written with `escapeKeyPart` so no part holds a `|`.
 */

/**
 * A free-text key part (a meet, federation, age category, WSO name) with
 * `%` written `%25` and `|` written `%7C`, and nothing else changed, so a
 * key's `|` always separates parts: `natKey('a|b', 'c')` and
 * `natKey('a', 'b|c')` differ, and the prefix `meet|A|` covers only meet
 * `A`'s views, never those of a meet named `A|session|1` (issue #192).
 *
 * A part with neither character keeps the key it had before parts were
 * escaped, byte for byte, so no stored view moved and, while no stored name
 * holds `%`, no rebuild is needed for the deploy. A part holding `%` has a
 * new key. Its view under the old key is not read by its own name again: a
 * reader misses and computes the answer live (a national ranking over one
 * page answers "being built") until the next build writes the new key.
 * `views:rebuildAll`'s sweep deletes the old view as one it did not rebuild,
 * and `buildWso` deletes an old WSO key itself as a key of no current WSO.
 * Until then, an old key whose name holds `%7C` or `%25` literally
 * (`meet|A%7CB|…`) is also the new key of another name (`A|B`) and answers
 * for it. So if a stored name holds `%`, run `views:rebuildAll` right after
 * the deploy.
 */
export const escapeKeyPart = (part: string) => part.replace(/%/g, '%25').replace(/\|/g, '%7C');
/** The part `escapeKeyPart` was given, from what it returned. */
export const unescapeKeyPart = (escaped: string) => escaped.replace(/%7C|%25/g, (code) => (code === '%7C' ? '|' : '%'));

export const natKey = (federation: string, ageCategory: string) =>
  `nat|${escapeKeyPart(federation)}|${escapeKeyPart(ageCategory)}`;

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
/** Every view of one meet, and of no other meet, has a key starting with this. */
export const meetViewsPrefix = (meet: string) => `meet|${escapeKeyPart(meet)}|`;
export const meetKey = (meet: string, part: MeetViewPart) => `${meetViewsPrefix(meet)}${part}`;
/** One session's start list (`/meets/athletes-sessions?session_number=`), all platforms. */
export const meetSessionKey = (meet: string, sessionNumber: number) => `${meetSessionPrefix(meet)}${sessionNumber}`;
export const meetSessionPrefix = (meet: string) => `${meetViewsPrefix(meet)}session|`;

export const REF_VIEWS = {
  records: 'ref|records',
  standards: 'ref|standards',
  qualifying_totals: 'ref|qualifying_totals',
  intl_rankings: 'ref|intl_rankings',
  clubs: 'ref|clubs',
  wso_list: 'ref|wso_list',
} as const;

export const wsoKey = (wso: string) => `wso|${escapeKeyPart(wso)}`;
export const adaptiveKey = (gender: string, excludeFederation: string, season: string) =>
  `adaptive|${escapeKeyPart(gender.toLowerCase())}|${escapeKeyPart(excludeFederation)}|${escapeKeyPart(season)}`;

/**
 * Every meet that has views (a meet row or a roster), sorted: the meets a
 * refresh checks rosters of when an athlete's results change. Kept up to date
 * by the refresh from its meet hints and rewritten by the full rebuild, so no
 * refresh has to rediscover it from the tables.
 */
export const MEET_INDEX_VIEW = 'index|meets';

/**
 * Key prefixes of the refresh machinery's own documents (the search
 * directory, the meet index, the rebuild's scratch views): read whatever
 * their age, never served as fresh, and never swept as orphans.
 */
export const INTERNAL_VIEW_PREFIXES = ['search|', 'index|', 'rebuild|'] as const;

/** The search directory; served whatever its age (see `results:search`). */
export const RESULT_NAMES_VIEW = 'search|names';
/** The search directory's two-letter shards (`lib/directory.ts`) and their sizes. */
export const SEARCH_SHARD_PREFIX = 'search|bigram|';
export const searchShardKey = (bigram: string) => `${SEARCH_SHARD_PREFIX}${encodeURIComponent(bigram)}`;
/**
 * The shard size table, versioned by how `foldForShards` folds names: shards
 * built under an older fold miss names a query now matches, so a new fold
 * gets a new key, and until a full shard build writes it every query reads
 * the whole directory (correct, only slower). Bump it with the fold.
 */
export const SEARCH_SHARD_SIZES_VIEW = 'search|bigram-sizes|v2';
/** Size tables of older folds, deleted by the next full shard build. */
export const LEGACY_SEARCH_SHARD_SIZES_VIEWS = ['search|bigram-sizes'] as const;

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

// ---------------------------------------------------------------------------
// Freshness, per key
// ---------------------------------------------------------------------------

/** A pending change (`view_hints`), as `ingest.recordWrite` names it. */
export type HintId = { kind: string; key: string };

export type ViewDependencies = {
  /** While any of these hints is pending, the view may be out of date. */
  hints: HintId[];
  /**
   * The view also reads the results of the meet's roster athletes (year-best
   * timelines, previous bests): a pending `athlete` hint for one of them
   * makes it out of date too, as `athleteChangeAffects` decides.
   */
  roster?: { meet: string; part: 'timelines' | 'stats' };
};

/** A key of a family built from data, read back into what built it. */
export type ParsedViewKey =
  | { family: 'meet'; meet: string; part: MeetViewPart }
  | { family: 'session'; meet: string; sessionNumber: number }
  | { family: 'nat'; federation: string; ageCategory: string }
  | { family: 'adaptive'; gender: string; excludeFederation: string; season: string }
  | { family: 'wso'; wso: string };

// An escaped part holds no `|`, so each `([^|]*)` is exactly one part.
const MEET_PART_PATTERN = new RegExp(`^meet\\|([^|]*)\\|(${MEET_VIEW_PARTS.join('|')})$`);
const MEET_SESSION_PATTERN = /^meet\|([^|]*)\|session\|(\d+)$/;
const NAT_PATTERN = /^nat\|([^|]*)\|([^|]*)$/;
const ADAPTIVE_PATTERN = /^adaptive\|([^|]*)\|([^|]*)\|([^|]*)$/;
const WSO_PATTERN = /^wso\|([^|]*)$/;

/**
 * The arguments a meet, session, national ranking, adaptive or WSO key was
 * built from (the adaptive gender as the key holds it, lowercased); null for
 * any other key, including one of these families in a shape no builder makes.
 */
export function parseViewKey(key: string): ParsedViewKey | null {
  const session = MEET_SESSION_PATTERN.exec(key);
  if (session) return { family: 'session', meet: unescapeKeyPart(session[1]), sessionNumber: Number(session[2]) };
  const meetPart = MEET_PART_PATTERN.exec(key);
  if (meetPart) return { family: 'meet', meet: unescapeKeyPart(meetPart[1]), part: meetPart[2] as MeetViewPart };
  const nat = NAT_PATTERN.exec(key);
  if (nat) return { family: 'nat', federation: unescapeKeyPart(nat[1]), ageCategory: unescapeKeyPart(nat[2]) };
  const adaptive = ADAPTIVE_PATTERN.exec(key);
  if (adaptive) {
    const [gender, excludeFederation, season] = adaptive.slice(1).map(unescapeKeyPart);
    return { family: 'adaptive', gender, excludeFederation, season };
  }
  const wso = WSO_PATTERN.exec(key);
  if (wso) return { family: 'wso', wso: unescapeKeyPart(wso[1]) };
  return null;
}

const REF_VIEW_TABLES: Record<string, string> = {
  [REF_VIEWS.records]: 'records',
  [REF_VIEWS.standards]: 'standards',
  [REF_VIEWS.qualifying_totals]: 'qualifying_totals',
  [REF_VIEWS.intl_rankings]: 'intl_rankings',
  // The club list is every roster's clubs; roster writes leave this hint.
  [REF_VIEWS.clubs]: 'athletes',
  [REF_VIEWS.wso_list]: 'wso_records',
};

/**
 * What a view is built from, as the hints that name it, derived from its key
 * alone (so headers written before this existed are covered too). A key of no
 * known family has none and is never served as fresh: a new view family must
 * be added here before it can be served, rather than be served stale because
 * it was forgotten.
 */
export function viewDependencies(key: string): ViewDependencies | null {
  const parsed = parseViewKey(key);
  switch (parsed?.family) {
    case 'session':
      return { hints: [{ kind: 'meet', key: parsed.meet }] };
    case 'meet': {
      const { meet, part } = parsed;
      const hints = [{ kind: 'meet', key: meet }];
      return part === 'timelines' || part === 'stats' ? { hints, roster: { meet, part } } : { hints };
    }
    case 'nat':
      return { hints: [{ kind: 'nat', key: JSON.stringify([parsed.federation, parsed.ageCategory]) }] };
    case 'adaptive':
      return { hints: [{ kind: 'adaptive', key: '1' }] };
    case 'wso':
      return { hints: [{ kind: 'table', key: 'wso_records' }] };
    default: {
      const table = REF_VIEW_TABLES[key];
      return table === undefined ? null : { hints: [{ kind: 'table', key: table }] };
    }
  }
}

/**
 * Whether a change to an athlete's results, the earliest changed result dated
 * `since` (undefined: not known), can change a meet's `part` view, whose
 * header `meta` is the timelines' horizon or the stats' latest finisher date.
 *
 * Timelines hold every result from the horizon on, and one hint can cover
 * results on both sides of it, so any change counts. Stats depend only on
 * results dated before each finisher's result at the meet (`previous_best`),
 * so a change dated on or after the meet's latest finisher date cannot reach
 * them; a change to the meet's own results also leaves a `meet` hint.
 */
export function athleteChangeAffects(part: 'timelines' | 'stats', since: string | undefined, meta: string | undefined): boolean {
  if (part === 'timelines') return true;
  return since === undefined || meta === undefined || since < meta;
}

/** The earlier of two hint dates; undefined (date not known) wins. */
export function earliestSince(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined || b === undefined) return undefined;
  return a < b ? a : b;
}
