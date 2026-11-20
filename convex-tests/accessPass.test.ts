import { ConvexError } from 'convex/values';
import { getFunctionName } from 'convex/server';
import { ACCESS_PASS_ROTATION_MS, partnerPass, pass, rotate, store } from '../convex/accessPass';
import { checkPass, setPremiumModeForTests } from '../convex/lib/access';
import { fakeMutationCtx, handlerOf } from './fakeDb';

/**
 * The shared access pass (`convex/accessPass.ts`): only subscribers get it,
 * and a rotation keeps the pass it replaced.
 */

const NOW = Date.UTC(2026, 9, 13, 9);
const A = 'user_a';
const clerk = (subject: string) => ({ subject, issuer: 'https://clerk.example.com' });

async function statusOf(promise: Promise<unknown>): Promise<number | 'ok'> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof ConvexError) return (error.data as { status: number }).status;
    throw error;
  }
}

function passFor(identity: Record<string, unknown> | null, seed: Record<string, Record<string, unknown>[]>) {
  const db = fakeMutationCtx(seed);
  return handlerOf<Record<string, never>, { pass: string; rotatesAt: number }>(pass)({ ...db.ctx, auth: { getUserIdentity: async () => identity } }, {});
}

const passes = { access_passes: [{ current: 'today', previous: 'yesterday', rotatedAt: NOW }] };
const subscriber = { entitlements: [{ userId: A, active: true, expiresAt: null, productId: 'lifetime' }] };

describe('accessPass:pass', () => {
  it('gives a subscriber the current pass and when to ask again', async () => {
    expect(await passFor(clerk(A), { ...passes, ...subscriber })).toEqual({ pass: 'today', rotatesAt: NOW + ACCESS_PASS_ROTATION_MS });
  });

  it('refuses the signed out with 401 and users without an active entitlement with 403', async () => {
    expect(await statusOf(passFor(null, { ...passes, ...subscriber }))).toBe(401);
    expect(await statusOf(passFor(clerk(A), passes))).toBe(403);
    expect(await statusOf(passFor(clerk(A), { ...passes, entitlements: [{ userId: A, active: false, expiresAt: null, productId: null }] }))).toBe(403);
  });

  it('answers 503 before the first rotation', async () => {
    expect(await statusOf(passFor(clerk(A), subscriber))).toBe(503);
  });
});

describe('accessPass:partnerPass', () => {
  const SECRET = 'a'.repeat(64);
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env.ATLAS_ACCESS_PASS_SECRET;
    process.env.ATLAS_ACCESS_PASS_SECRET = SECRET;
  });

  afterEach(() => {
    setPremiumModeForTests(null);
    if (previous === undefined) delete process.env.ATLAS_ACCESS_PASS_SECRET;
    else process.env.ATLAS_ACCESS_PASS_SECRET = previous;
  });

  function partnerPassFor(secret: string, seed: Record<string, Record<string, unknown>[]> = passes) {
    const db = fakeMutationCtx(seed);
    return handlerOf<{ secret: string }, { pass: string; rotatesAt: number }>(partnerPass)(
      { ...db.ctx, auth: { getUserIdentity: async () => null } },
      { secret },
    );
  }

  it('gives the shared secret the current pass and when to ask again, with no signed-in user', async () => {
    expect(await partnerPassFor(SECRET)).toEqual({ pass: 'today', rotatesAt: NOW + ACCESS_PASS_ROTATION_MS });
  });

  it('refuses a wrong secret of the same length with 401', async () => {
    expect(await statusOf(partnerPassFor('b'.repeat(64)))).toBe(401);
  });

  it('refuses a secret of another length with 401', async () => {
    expect(await statusOf(partnerPassFor(SECRET.slice(1)))).toBe(401);
    expect(await statusOf(partnerPassFor(`${SECRET}a`))).toBe(401);
    expect(await statusOf(partnerPassFor(''))).toBe(401);
  });

  it('answers 503 while the secret is unset or empty, whatever is sent', async () => {
    delete process.env.ATLAS_ACCESS_PASS_SECRET;
    expect(await statusOf(partnerPassFor(SECRET))).toBe(503);
    expect(await statusOf(partnerPassFor(''))).toBe(503);
    process.env.ATLAS_ACCESS_PASS_SECRET = '';
    expect(await statusOf(partnerPassFor(''))).toBe(503);
  });

  it('answers 503 before the first rotation', async () => {
    expect(await statusOf(partnerPassFor(SECRET, {}))).toBe(503);
  });

  it('hands out a pass the gate lets through in enforce mode', async () => {
    setPremiumModeForTests('enforce');
    const { pass: given } = await partnerPassFor(SECRET);
    const stored = { current: 'today', previous: 'yesterday' };
    expect(() => checkPass('results:byNames', given, stored)).not.toThrow();
    expect(() => checkPass('reference:qualifyingTotals', given, stored)).not.toThrow();
    expect(() => checkPass('reference:qualifyingTotals', given, { current: 'tomorrow', previous: given })).not.toThrow();
    expect(() => checkPass('reference:qualifyingTotals', given, { current: 'later', previous: 'tomorrow' })).toThrow();
  });
});

describe('rotation', () => {
  const put = handlerOf<{ pass: string; now: number }, void>(store);

  it('makes the new pass current and keeps the one it replaced', async () => {
    const db = fakeMutationCtx();
    await put(db.ctx, { pass: 'one', now: 1 });
    expect(db.rows('access_passes')).toEqual([{ current: 'one', previous: null, rotatedAt: 1 }]);
    await put(db.ctx, { pass: 'two', now: 2 });
    await put(db.ctx, { pass: 'three', now: 3 });
    expect(db.rows('access_passes')).toEqual([{ current: 'three', previous: 'two', rotatedAt: 3 }]);
  });

  it('draws a fresh 256-bit pass each time, and nothing on a dry run', async () => {
    const stored: string[] = [];
    const ctx = {
      runMutation: async (ref: unknown, args: { pass: string }) => {
        expect(getFunctionName(ref as never)).toBe('accessPass:store');
        stored.push(args.pass);
      },
    };
    await handlerOf(rotate)(ctx, {});
    await handlerOf(rotate)(ctx, {});
    await handlerOf(rotate)(ctx, { dryRun: true });
    expect(stored).toHaveLength(2);
    for (const value of stored) expect(value).toMatch(/^[0-9a-f]{64}$/);
    expect(stored[0]).not.toBe(stored[1]);
  });
});
