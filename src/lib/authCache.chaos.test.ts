import * as fc from 'fast-check';

import { cacheAuthState, clearAuthCache, getCachedAuthState } from '@/lib/authCache';
import { corruptedArb, hostileStringArb } from '@/test-support/arbitraries';
import { createChaosSecureStore, faultPlanArb, storageFaultArb, type StorageFault } from '@/test-support/chaos';

/**
 * The auth cache (`authCache.ts`) is a seven-day hint that a user was signed
 * in, trusted for offline *reads* only. Whatever SecureStore holds or does, a
 * read is a well-formed hint inside its window or no hint: never a throw,
 * never an expired or implausible entry, never a sign-in nobody made.
 */

// The factory runs when `authCache` imports SecureStore, before this file's
// own statements, so the store is built inside it and read back below.
jest.mock('expo-secure-store', () =>
  (jest.requireActual('@/test-support/chaos') as typeof import('@/test-support/chaos')).createChaosSecureStore(),
);
const secureStore = jest.requireMock('expo-secure-store') as ReturnType<typeof createChaosSecureStore>;

const KEY = 'auth_state_cache';
const DAY = 24 * 60 * 60 * 1000;
const EXPIRY = 7 * DAY;
const T0 = Date.UTC(2026, 5, 20, 12);

/** Honest failures: a locked Keychain rejects, a full disk rejects. */
const honestFaultArb = fc.constantFrom<StorageFault>({ kind: 'pass' }, { kind: 'reject' }, { kind: 'quota' });

/** Offsets from a write, biased to the edges of the seven-day window and its skew allowance. */
const offsetArb = fc.oneof(
  fc.constantFrom(0, EXPIRY, EXPIRY + 1, EXPIRY - 1, -EXPIRY, -EXPIRY - 1, -EXPIRY + 1, DAY, -DAY),
  fc.integer({ min: -3 * EXPIRY, max: 3 * EXPIRY }),
);

function assertUsableHint(hint: unknown, now: number): void {
  expect(hint).not.toBeNull();
  const value = hint as { isSignedIn: unknown; timestamp: number; userId?: unknown };
  expect(typeof value.isSignedIn).toBe('boolean');
  expect(Number.isFinite(value.timestamp)).toBe(true);
  expect(value.timestamp).toBeGreaterThanOrEqual(0);
  expect(value.userId === undefined || typeof value.userId === 'string').toBe(true);
  // Inside the window: not older than seven days, not further ahead than the
  // clock-skew allowance.
  expect(now - value.timestamp).toBeLessThanOrEqual(EXPIRY);
  expect(value.timestamp - now).toBeLessThanOrEqual(EXPIRY);
}

async function reset(): Promise<void> {
  secureStore.reset();
  await clearAuthCache();
}

beforeEach(async () => {
  jest.useFakeTimers({ now: T0 });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  await reset();
});

afterEach(() => {
  secureStore.reset();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('auth cache reads', () => {
  const valid = { isSignedIn: true, timestamp: T0, userId: 'user_1' };
  const storedBytesArb = fc.oneof(
    hostileStringArb,
    fc.jsonValue({ maxDepth: 2 }).map((value) => JSON.stringify(value)),
    corruptedArb(valid).map((value) => JSON.stringify(value) ?? ''),
    fc.string({ maxLength: 60 }).map((tail) => JSON.stringify(valid).slice(0, tail.length)),
  );

  it('reads any stored bytes as a usable hint or as none, never a throw', async () => {
    await fc.assert(
      fc.asyncProperty(storedBytesArb, offsetArb, async (bytes, offset) => {
        await reset();
        jest.setSystemTime(T0);
        secureStore.data.set(KEY, bytes);
        jest.setSystemTime(T0 + offset);

        const hint = await getCachedAuthState();
        if (hint === null) return;
        assertUsableHint(hint, T0 + offset);
        // Exactly what was stored: a well-formed corruption (another user id,
        // `isSignedIn` flipped) cannot be told apart, but nothing is half-read.
        expect(hint).toEqual(JSON.parse(bytes));
      }),
    );
  });

  it('honours the seven-day window and the skew allowance to the millisecond', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), offsetArb, async (signedIn, offset) => {
        await reset();
        jest.setSystemTime(T0);
        await cacheAuthState(signedIn, signedIn ? 'user_1' : undefined);

        jest.setSystemTime(T0 + offset);
        const hint = await getCachedAuthState();
        if (offset > EXPIRY || offset < -EXPIRY) {
          expect(hint).toBeNull();
        } else {
          expect(hint).toEqual({ isSignedIn: signedIn, timestamp: T0, userId: signedIn ? 'user_1' : undefined });
        }
      }),
    );
  });

  it('an expired hint stays expired, even if the clock is set back afterwards', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: EXPIRY + 1, max: 10 * EXPIRY }),
        fc.integer({ min: -EXPIRY, max: EXPIRY }),
        async (expiredAt, rewind) => {
          await reset();
          jest.setSystemTime(T0);
          await cacheAuthState(true, 'user_1');
          jest.setSystemTime(T0 + expiredAt);
          expect(await getCachedAuthState()).toBeNull();
          // The device clock is corrected back into the original window.
          jest.setSystemTime(T0 + rewind);
          expect(await getCachedAuthState()).toBeNull();
        },
      ),
    );
  });
});

describe('auth cache under SecureStore chaos', () => {
  type Op =
    | { kind: 'cache'; signedIn: boolean; userId: string | undefined }
    | { kind: 'clear' }
    | { kind: 'read' }
    | { kind: 'tick'; ms: number };

  const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({
      kind: fc.constant('cache' as const),
      signedIn: fc.boolean(),
      userId: fc.option(fc.constantFrom('user_1', 'user_2'), { nil: undefined }),
    }),
    fc.constant<Op>({ kind: 'clear' }),
    fc.constant<Op>({ kind: 'read' }),
    fc.record({ kind: fc.constant('tick' as const), ms: fc.integer({ min: -2 * EXPIRY, max: 2 * EXPIRY }) }),
  );

  it('never throws, and every hint read is usable and was written by this app', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { maxLength: 12 }), faultPlanArb(storageFaultArb, 12), async (ops, plan) => {
        await reset();
        let now = T0;
        jest.setSystemTime(now);
        secureStore.setFaults(plan);
        const signedInUsers = new Set<string | undefined>();
        const corrupting = plan.some((fault) => fault.kind === 'corrupt-read');

        for (const op of ops) {
          if (op.kind === 'tick') {
            now += op.ms;
            jest.setSystemTime(now);
          } else if (op.kind === 'cache') {
            if (op.signedIn) signedInUsers.add(op.userId);
            await cacheAuthState(op.signedIn, op.userId);
          } else if (op.kind === 'clear') {
            await clearAuthCache();
          } else {
            const hint = await getCachedAuthState();
            if (hint === null) continue;
            assertUsableHint(hint, now);
            // A corrupt read can hand back any bytes; with honest storage a
            // signed-in hint is always one this app wrote.
            if (hint.isSignedIn && !corrupting) expect(signedInUsers.has(hint.userId)).toBe(true);
          }
        }
      }),
    );
  });

  // Regression: `clearAuthCache` used to log a failed Keychain delete and
  // resolve, leaving the signed-in hint that `useStorageUser` trusts whenever
  // Clerk has no user, so a signed-out user's saved sessions stayed on screen
  // (seed 943584651: a `quota` on the delete, then a healthy read returned
  // `user_1`). A *lost* delete (`lose-write`) is out of scope: the app cannot
  // know about it.
  it('after a sign-out, the hint never reads as signed in, even when the delete fails', async () => {
    await fc.assert(
      fc.asyncProperty(faultPlanArb(honestFaultArb, 3), async (plan) => {
        await reset();
        await cacheAuthState(true, 'user_1');
        secureStore.setFaults(plan);
        await clearAuthCache();
        secureStore.setFaults([]);
        const hint = await getCachedAuthState();
        expect(hint?.isSignedIn ?? false).toBe(false);
      }),
    );
  });

  // The shrunk counterexample of the regression above.
  it('does not read a signed-in hint after a sign-out whose delete failed', async () => {
    await cacheAuthState(true, 'user_1');
    secureStore.setFaults([{ kind: 'quota' }]);
    await expect(clearAuthCache()).resolves.toBeUndefined();
    secureStore.setFaults([]);
    expect(await getCachedAuthState()).toBeNull();
  });

  it('writes a signed-out entry over a hint it could not delete, for the next process', async () => {
    await cacheAuthState(true, 'user_1');
    secureStore.setFaults([{ kind: 'reject' }]);
    await clearAuthCache();
    expect(JSON.parse(secureStore.data.get(KEY) ?? 'null')).toEqual({ isSignedIn: false, timestamp: T0 });
  });

  it('reads no hint while neither the delete nor the overwrite landed', async () => {
    await cacheAuthState(true, 'user_1');
    secureStore.setFaults([{ kind: 'reject' }, { kind: 'quota' }]);
    await clearAuthCache();
    // Still on disk: only a fresh process could read it (the residual case).
    expect(JSON.parse(secureStore.data.get(KEY) ?? 'null')).toMatchObject({ isSignedIn: true });
    expect(await getCachedAuthState()).toBeNull();
  });

  it('trusts the hint again once a later sign-in is cached', async () => {
    await cacheAuthState(true, 'user_1');
    secureStore.setFaults([{ kind: 'reject' }, { kind: 'reject' }]);
    await clearAuthCache();
    // The same user signs back in: the write is not deduplicated away.
    await cacheAuthState(true, 'user_1');
    expect(await getCachedAuthState()).toMatchObject({ isSignedIn: true, userId: 'user_1' });
  });

  it('keeps reading no hint when the sign-in after a failed clear also fails to write', async () => {
    await cacheAuthState(true, 'user_1');
    secureStore.setFaults([{ kind: 'reject' }, { kind: 'reject' }, { kind: 'reject' }]);
    await clearAuthCache();
    await cacheAuthState(true, 'user_2');
    expect(await getCachedAuthState()).toBeNull();
  });

  it('a failed sign-in write never leaves a signed-in hint behind', async () => {
    await fc.assert(
      fc.asyncProperty(faultPlanArb(honestFaultArb, 2), async (plan) => {
        await reset();
        secureStore.setFaults(plan);
        await expect(cacheAuthState(true, 'user_1')).resolves.toBeUndefined();
        secureStore.setFaults([]);
        const hint = await getCachedAuthState();
        // Either the write landed (and the hint is the user's) or there is none.
        if (hint !== null) expect(hint).toMatchObject({ isSignedIn: true, userId: 'user_1' });
        if (plan[0]?.kind === 'reject' || plan[0]?.kind === 'quota') expect(hint).toBeNull();
      }),
    );
  });
});
