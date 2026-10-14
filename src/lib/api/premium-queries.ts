/**
 * The Convex queries that answer premium data (`PREMIUM_FUNCTIONS` in
 * `convex/lib/access.ts`; a test keeps the two lists equal). Calls to these
 * carry the shared access pass (`convex/accessPass.ts`) as their `pass`
 * argument. Every subscriber holds the same pass, so Convex answers each
 * premium read from one cache entry for everyone, and no read waits on the
 * user's sign-in.
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

/** The pass, and when to ask for the next one (`accessPass:pass`). */
export type AccessPass = { pass: string; rotatesAt: number };

/** How long a premium read waits for a pass it does not hold before going without it. */
export const ACCESS_PASS_TIMEOUT_MS = 3000;
/**
 * After a pass could not be had (offline, not subscribed after all), how long
 * premium reads go without asking again, so a run of reads (a meet
 * download's batches) does not wait `ACCESS_PASS_TIMEOUT_MS` each.
 */
export const ACCESS_PASS_RETRY_AFTER_MS = 30_000;
/**
 * The least time a pass is held before the next is asked for, whatever its
 * `rotatesAt` says: a device clock running ahead, or a late rotation, must not
 * turn every premium read into a pass fetch. The server keeps accepting a
 * pass for a day after it rotates.
 */
export const ACCESS_PASS_MIN_HOLD_MS = 5 * 60 * 1000;
/**
 * How long a premium read waits for its source to be ready (Clerk loading on
 * a cold start) before going without a pass. The pass fetch's own
 * `ACCESS_PASS_TIMEOUT_MS` starts once it is.
 */
export const ACCESS_PASS_READY_TIMEOUT_MS = 5000;

type PassSource = () => Promise<AccessPass | null>;

let source: PassSource | null = null;
/** When the source became ready to fetch, in ms; null until it has. */
let readyTime: number | null = 0;
let readyAt: Promise<number> = Promise.resolve(0);
let held: { pass: string; until: number } | null = null;
let fetching: { from: PassSource; startedAt: number; done: Promise<AccessPass | null> } | null = null;
let skipUntil = 0;

/**
 * Where the pass comes from: `accessPass:pass` with the user's Clerk token
 * while a subscriber is signed in, `null` otherwise (`useServerDataAccess`).
 * `ready` settles when the source can fetch (Clerk has loaded); no fetch
 * starts before it, and the wait for it does not count against the fetch.
 * Forgets the pass held for the previous source.
 */
export function setAccessPassSource(next: PassSource | null, ready?: Promise<void>): void {
  source = next;
  if (ready === undefined) {
    readyTime = Date.now();
    readyAt = Promise.resolve(readyTime);
  } else {
    readyTime = null;
    readyAt = ready.then(() => {
      const at = Date.now();
      if (source === next) readyTime = at;
      return at;
    });
  }
  held = null;
  fetching = null;
  skipUntil = 0;
}

/** Whether a call reads premium data. `results:search` does only with dates: name suggestions are public. */
export function isPremiumCall(fn: string, args: Record<string, unknown>): boolean {
  if (!PREMIUM_QUERY_FUNCTIONS.has(fn)) return false;
  return fn !== 'results:search' || (args.startDate !== undefined && args.endDate !== undefined);
}

/** Whether a call should carry the pass: a premium one, while a subscriber is signed in. */
export function wantsAccessPass(fn: string, args: Record<string, unknown> = {}): boolean {
  return source !== null && isPremiumCall(fn, args);
}

/**
 * The fetch in flight, or a new one. It runs to the end however long it
 * takes, and stores what it gets for the source it was made for: a read that
 * stopped waiting does not throw a slow pass away.
 */
function fetchPass(from: PassSource): { startedAt: number; done: Promise<AccessPass | null> } {
  if (fetching?.from === from) return fetching;
  const startedAt = Date.now();
  const done = from()
    .catch(() => null)
    .then((pass) => {
      if (source === from) {
        if (pass) held = { pass: pass.pass, until: Math.max(pass.rotatesAt, Date.now() + ACCESS_PASS_MIN_HOLD_MS) };
        else skipUntil = Date.now() + ACCESS_PASS_RETRY_AFTER_MS;
      }
      if (fetching?.done === done) fetching = null;
      return pass;
    });
  fetching = { from, startedAt, done };
  return fetching;
}

/** `done`, or null once `deadline` passes. */
async function until<T>(done: Promise<T>, deadline: number): Promise<T | null> {
  const wait = deadline - Date.now();
  if (wait <= 0) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), wait);
  });
  try {
    return await Promise.race([done, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The pass a premium read should carry. The one held is used until it is due
 * for renewal, and past that (the server still accepts it for a day) while a
 * new one cannot be had; otherwise one is fetched, once for all the reads that
 * want it, each waiting at most `ACCESS_PASS_TIMEOUT_MS` from the fetch's
 * start, once the source is ready (`setAccessPassSource`). `retry` is a read
 * the server refused for its pass (`refused`, or none): a refused pass is
 * dropped unless another read already replaced it, and the read waits a fresh
 * `ACCESS_PASS_TIMEOUT_MS` for a new one, joining a fetch still running.
 * Without a pass the read goes anyway.
 */
export async function accessPassFor(
  fn: string,
  args: Record<string, unknown> = {},
  { refused, retry = false }: { refused?: string; retry?: boolean } = {},
): Promise<string | undefined> {
  const from = source;
  if (!from || !isPremiumCall(fn, args)) return undefined;
  if (retry && refused !== undefined && held?.pass === refused) held = null;
  if (held && (Date.now() < held.until || (retry && held.pass !== refused))) return held.pass;
  if (!retry && Date.now() < skipUntil) return held?.pass;
  if (readyTime === null) {
    const ready = await until(readyAt, Date.now() + ACCESS_PASS_READY_TIMEOUT_MS);
    if (source !== from) return undefined;
    if (ready === null) return held?.pass;
  }
  const { startedAt, done } = fetchPass(from);
  const pass = await until(done, (retry ? Date.now() : startedAt) + ACCESS_PASS_TIMEOUT_MS);
  // The user changed while waiting: the pass was theirs.
  if (source !== from) return undefined;
  return pass?.pass ?? held?.pass;
}

/** Fetches the pass ahead of the first premium read, so that read does not wait. */
export function prefetchAccessPass(): void {
  void accessPassFor('reference:records');
}
