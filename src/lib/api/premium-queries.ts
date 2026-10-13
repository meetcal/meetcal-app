/**
 * The Convex queries that answer premium data (`PREMIUM_FUNCTIONS` in
 * `convex/lib/access.ts`; a test keeps the two lists equal). Calls to these
 * carry the signed-in user's Clerk token so the server can tell a subscriber
 * from everyone else. Every other read stays anonymous, so Convex answers it
 * from the cache it shares across users.
 */
export const PREMIUM_QUERY_FUNCTIONS: ReadonlySet<string> = new Set([
  'reference:records',
  'reference:standards',
  'reference:qualifyingTotals',
  'reference:intlRankings',
  'reference:nationalRankings',
  'reference:nationalRankingsByYear',
  'reference:wsoList',
  'reference:registrationWsos',
  'reference:wsoAgeGroups',
  'reference:wsoRecords',
  'reference:adaptiveRecords',
  'reference:clubs',
  'reference:clubAthletes',
  'reference:wsoAthletes',
  'reference:clubMeetStats',
  'results:page',
  'results:byMeet',
  'results:byNames',
  'results:recent',
  'results:yearBests',
  'results:bests',
  'results:search',
  'meets:packageForMeet',
]);

/** How long a premium read waits for Clerk's token before going without it. */
export const DATA_TOKEN_TIMEOUT_MS = 1500;

type TokenSource = () => Promise<string | null>;

let tokenSource: TokenSource | null = null;

/**
 * Where premium reads get the signed-in user's token: Clerk's `getToken` while
 * a subscriber is signed in, `null` otherwise (`useServerDataAccess`).
 */
export function setDataTokenSource(source: TokenSource | null): void {
  tokenSource = source;
}

/** Whether a call to `fn` should wait for a token: a premium query, while someone is signed in. */
export function wantsDataToken(fn: string): boolean {
  return tokenSource !== null && PREMIUM_QUERY_FUNCTIONS.has(fn);
}

/**
 * The token a call to `fn` should carry: the signed-in user's for a premium
 * query, otherwise none. A token Clerk cannot give within
 * `DATA_TOKEN_TIMEOUT_MS` (offline, still loading) is left off: the read goes
 * anonymously rather than waiting on sign-in.
 */
export async function dataTokenFor(fn: string): Promise<string | undefined> {
  const source = tokenSource;
  if (!source || !PREMIUM_QUERY_FUNCTIONS.has(fn)) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), DATA_TOKEN_TIMEOUT_MS);
  });
  try {
    const token = await Promise.race([source().catch(() => null), timeout]);
    return typeof token === 'string' && token.length > 0 ? token : undefined;
  } finally {
    clearTimeout(timer);
  }
}
