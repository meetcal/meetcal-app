import { mutation, query } from './_generated/server';

/**
 * The server clock, for `getTrustedNow()` in the app. A mutation rather than
 * a query: query results are cached, and a cached clock is a stale one.
 */
export const serverTime = mutation({
  args: {},
  handler: async () => Date.now(),
});

/** Returns a constant, so it is always a cache hit: the round-trip floor for benchmarks. */
export const ping = query({ args: {}, handler: async () => 1 });
