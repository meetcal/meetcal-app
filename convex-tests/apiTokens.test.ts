import { ConvexError } from 'convex/values';
import { getFunctionName } from 'convex/server';
import { API_TOKEN_AUDIENCE, API_TOKEN_TTL_MS, issue, jwks, MAX_API_TOKENS_PER_USER, record, revoke } from '../convex/apiTokens';
import { parseSigningJwk, publicJwk, signJwt, type SigningJwk } from '../convex/lib/jwt';
import { fakeMutationCtx, handlerOf } from './fakeDb';

/**
 * MeetCal-issued tokens (`convex/apiTokens.ts`): signed so Convex can verify
 * them against the published key, issued only to a Clerk session, and
 * revocable by deleting their row.
 */

const SITE = 'https://example.convex.site';
const A = 'user_a';
const clerk = (subject: string) => ({ subject, issuer: 'https://clerk.example.com' });
const meetcal = (subject: string, tid: string) => ({ subject, issuer: SITE, tid });

async function newSigningKey(kid = 'k1'): Promise<SigningJwk> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { ...(await crypto.subtle.exportKey('jwk', pair.privateKey)), kid } as SigningJwk;
}

const fromBase64Url = (text: string) => Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const decode = (part: string) => JSON.parse(fromBase64Url(part).toString('utf8')) as Record<string, unknown>;

/** Verifies `token` against the public JWK as Convex would. */
async function verify(token: string, key: SigningJwk): Promise<boolean> {
  const [header, payload, signature] = token.split('.');
  const { kty, crv, x, y } = publicJwk(key);
  const verifier = await crypto.subtle.importKey('jwk', { kty, crv, x, y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, fromBase64Url(signature), new TextEncoder().encode(`${header}.${payload}`));
}

async function statusOf(promise: Promise<unknown>): Promise<number | 'ok'> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof ConvexError) return (error.data as { status: number }).status;
    throw error;
  }
}

describe('ES256 signing', () => {
  it('makes a token the public key verifies, with the header Convex expects', async () => {
    const key = await newSigningKey();
    const token = await signJwt(key, { sub: A });
    expect(decode(token.split('.')[0])).toEqual({ alg: 'ES256', typ: 'JWT', kid: 'k1' });
    expect(decode(token.split('.')[1])).toEqual({ sub: A });
    expect(await verify(token, key)).toBe(true);
    expect(await verify(token, await newSigningKey())).toBe(false);
  });

  it('reads only a P-256 private JWK with a kid, and publishes only its public half', async () => {
    const key = await newSigningKey();
    expect(parseSigningJwk(JSON.stringify(key))).toEqual(key);
    expect(parseSigningJwk(undefined)).toBeNull();
    expect(parseSigningJwk('not json')).toBeNull();
    expect(parseSigningJwk(JSON.stringify({ ...key, kid: undefined }))).toBeNull();
    expect(parseSigningJwk(JSON.stringify({ ...key, d: undefined }))).toBeNull();
    expect(parseSigningJwk(JSON.stringify({ ...key, crv: 'P-384' }))).toBeNull();
    expect(publicJwk(key)).not.toHaveProperty('d');
  });
});

describe('issuing and revoking', () => {
  let previous: { key?: string; site?: string };
  let key: SigningJwk;

  beforeEach(async () => {
    previous = { key: process.env.MEETCAL_TOKEN_SIGNING_KEY, site: process.env.CONVEX_SITE_URL };
    key = await newSigningKey();
    process.env.MEETCAL_TOKEN_SIGNING_KEY = JSON.stringify(key);
    process.env.CONVEX_SITE_URL = SITE;
  });

  afterEach(() => {
    if (previous.key === undefined) delete process.env.MEETCAL_TOKEN_SIGNING_KEY;
    else process.env.MEETCAL_TOKEN_SIGNING_KEY = previous.key;
    if (previous.site === undefined) delete process.env.CONVEX_SITE_URL;
    else process.env.CONVEX_SITE_URL = previous.site;
    jest.restoreAllMocks();
  });

  function actionCtx(db: ReturnType<typeof fakeMutationCtx>, identity: Record<string, unknown> | null) {
    return {
      auth: { getUserIdentity: async () => identity },
      runMutation: async (ref: unknown, args: unknown) => {
        expect(getFunctionName(ref as never)).toBe('apiTokens:record');
        return handlerOf(record)(db.ctx, args);
      },
    };
  }
  const issueAs = (db: ReturnType<typeof fakeMutationCtx>, identity: Record<string, unknown> | null) =>
    handlerOf<{ client: string }, { token: string; tokenId: string; expiresAt: number }>(issue)(actionCtx(db, identity), { client: 'cli' });

  it('issues a Clerk user a verifiable token for this deployment, and records it', async () => {
    const db = fakeMutationCtx();
    const before = Date.now();
    const { token, tokenId, expiresAt } = await issueAs(db, clerk(A));
    expect(await verify(token, key)).toBe(true);
    const claims = decode(token.split('.')[1]);
    expect(claims).toMatchObject({ iss: SITE, sub: A, aud: API_TOKEN_AUDIENCE, tid: tokenId });
    expect(Number(claims.exp) * 1000).toBeGreaterThanOrEqual(before + API_TOKEN_TTL_MS - 1000);
    expect(db.rows('api_tokens')).toEqual([{ tokenId, userId: A, client: 'cli', createdAt: expect.any(Number), expiresAt }]);
  });

  it('refuses anonymous callers and MeetCal-issued tokens, so a leaked token cannot renew itself', async () => {
    const db = fakeMutationCtx();
    expect(await statusOf(issueAs(db, null))).toBe(401);
    expect(await statusOf(issueAs(db, meetcal(A, 't1')))).toBe(401);
    expect(db.rows('api_tokens')).toEqual([]);
  });

  it('answers 503 when no signing key is configured', async () => {
    delete process.env.MEETCAL_TOKEN_SIGNING_KEY;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await statusOf(issueAs(fakeMutationCtx(), clerk(A)))).toBe(503);
  });

  it("refuses a deleted account, and keeps a user's tokens under the cap by dropping the oldest", async () => {
    expect(await statusOf(issueAs(fakeMutationCtx({ deleted_users: [{ userId: A, deletedAt: 1 }] }), clerk(A)))).toBe(403);
    const held = Array.from({ length: MAX_API_TOKENS_PER_USER }, (_, i) => ({ tokenId: `t${i}`, userId: A, client: 'cli', createdAt: i + 1, expiresAt: 1e15 }));
    const db = fakeMutationCtx({ api_tokens: [...held, { tokenId: 'other', userId: 'user_b', client: 'cli', createdAt: 0, expiresAt: 1e15 }] });
    const { tokenId } = await issueAs(db, clerk(A));
    const mine = db.rows('api_tokens').filter((r) => r.userId === A).map((r) => r.tokenId);
    expect(mine).toHaveLength(MAX_API_TOKENS_PER_USER);
    expect(mine).not.toContain('t0');
    expect(mine).toContain(tokenId);
    expect(db.rows('api_tokens').map((r) => r.tokenId)).toContain('other');
  });

  it("revokes the calling token, or a Clerk user's named token, and never someone else's", async () => {
    const rows = [
      { tokenId: 't1', userId: A, client: 'cli', createdAt: 1, expiresAt: 1e15 },
      { tokenId: 't2', userId: A, client: 'siri', createdAt: 1, expiresAt: 1e15 },
      { tokenId: 'tb', userId: 'user_b', client: 'cli', createdAt: 1, expiresAt: 1e15 },
    ];
    const db = fakeMutationCtx({ api_tokens: rows });
    const as = (identity: Record<string, unknown> | null, args: Record<string, unknown>) =>
      statusOf(handlerOf(revoke)({ ...db.ctx, auth: { getUserIdentity: async () => identity } }, args));
    expect(await as(null, { tokenId: 't1' })).toBe(401);
    expect(await as(clerk(A), {})).toBe(400);
    // A MeetCal-issued token ends itself whatever it names.
    expect(await as(meetcal(A, 't1'), { tokenId: 't2' })).toBe('ok');
    expect(await as(clerk(A), { tokenId: 'tb' })).toBe('ok');
    expect(await as(clerk(A), { tokenId: 't2' })).toBe('ok');
    expect(await as(clerk(A), { tokenId: 'gone' })).toBe('ok');
    expect(db.rows('api_tokens').map((r) => r.tokenId)).toEqual(['tb']);
  });

  it('publishes the public key at the JWKS endpoint, and an empty set without one', async () => {
    const keys = async () => ((await (await handlerOf<unknown, Response>(jwks)({}, {})).json()) as { keys: unknown[] }).keys;
    expect(await keys()).toEqual([publicJwk(key)]);
    delete process.env.MEETCAL_TOKEN_SIGNING_KEY;
    expect(await keys()).toEqual([]);
  });
});
