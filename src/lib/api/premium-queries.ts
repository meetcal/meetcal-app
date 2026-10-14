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
/**
 * After Clerk gave no token (offline, a token it cannot refresh), how long
 * premium reads go anonymously without asking again, so a run of reads (a
 * meet download's batches) does not wait `DATA_TOKEN_TIMEOUT_MS` each.
 */
export const DATA_TOKEN_RETRY_AFTER_MS = 30_000;

type TokenSource = () => Promise<string | null>;

let tokenSource: TokenSource | null = null;
let pending: Promise<string | undefined> | null = null;
let skipUntil = 0;

/**
 * Where premium reads get the signed-in user's token: Clerk's `getToken` while
 * a subscriber is signed in, `null` otherwise (`useServerDataAccess`).
 */
export function setDataTokenSource(source: TokenSource | null): void {
  tokenSource = source;
  pending = null;
  skipUntil = 0;
}

/** Whether a call reads premium data. `results:search` does only with dates: name suggestions are public. */
export function isPremiumCall(fn: string, args: Record<string, unknown>): boolean {
  if (!PREMIUM_QUERY_FUNCTIONS.has(fn)) return false;
  return fn !== 'results:search' || (args.startDate !== undefined && args.endDate !== undefined);
}

/** Whether a call should wait for a token: a premium one, while a subscriber is signed in and Clerk last answered. */
export function wantsDataToken(fn: string, args: Record<string, unknown> = {}): boolean {
  return tokenSource !== null && Date.now() >= skipUntil && isPremiumCall(fn, args);
}

async function askClerk(source: TokenSource): Promise<string | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), DATA_TOKEN_TIMEOUT_MS);
  });
  try {
    const token = await Promise.race([source().catch(() => null), timeout]);
    if (typeof token === 'string' && token.length > 0) return token;
    if (tokenSource === source) skipUntil = Date.now() + DATA_TOKEN_RETRY_AFTER_MS;
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The token a call should carry: the signed-in subscriber's for a premium
 * call, otherwise none. Concurrent reads share one request to Clerk. A token
 * Clerk cannot give within `DATA_TOKEN_TIMEOUT_MS` (offline, still loading)
 * is left off, and so it is for the next `DATA_TOKEN_RETRY_AFTER_MS`: the
 * read goes anonymously rather than waiting on sign-in.
 */
export function dataTokenFor(fn: string, args: Record<string, unknown> = {}): Promise<string | undefined> {
  const source = tokenSource;
  if (!source || !wantsDataToken(fn, args)) return Promise.resolve(undefined);
  if (!pending) {
    const asked = askClerk(source).finally(() => {
      if (pending === asked) pending = null;
    });
    pending = asked;
  }
  return pending;
}
