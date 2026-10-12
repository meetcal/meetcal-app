import { mutation, query } from './_generated/server';

/**
 * The server clock, for app bundles that predate reading it from `ping`'s
 * `Date` header (and for the app's fallback when a response has none). A
 * mutation rather than a query: query results are cached, and a cached clock
 * is a stale one. That also means every call runs and is billed, so nothing
 * new should call it; remove it once no supported app bundle does.
 */
export const serverTime = mutation({
  args: {},
  handler: async () => Date.now(),
});

/**
 * Returns a constant, so it is always a cache hit: the round-trip floor for
 * benchmarks, and the app's server clock (the HTTP `Date` header of its
 * answer, `serverClockMs` in `src/lib/api/transport.ts`).
 */
export const ping = query({ args: {}, handler: async () => 1 });
