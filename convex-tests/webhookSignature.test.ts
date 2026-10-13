import { verifyWebhook, webhookSignature, WEBHOOK_TOLERANCE_S } from '../convex/lib/webhookSignature';

const SECRET = `whsec_${Buffer.from('a test secret of some length').toString('base64')}`;
const NOW = Date.UTC(2026, 9, 12, 12);
const body = JSON.stringify({ type: 'user.deleted', data: { id: 'user_a', deleted: true } });

async function headers(timestampS = NOW / 1000, secret = SECRET) {
  const timestamp = String(timestampS);
  return { id: 'msg_1', timestamp, signature: `v1,${await webhookSignature(secret, 'msg_1', timestamp, body)}` };
}

describe('Svix webhook verification (#250)', () => {
  it('accepts a signature made with the secret, among others', async () => {
    const signed = await headers();
    expect(await verifyWebhook(SECRET, signed, body, NOW)).toEqual({ ok: true });
    expect(await verifyWebhook(SECRET, { ...signed, signature: `v1,bogus ${signed.signature}` }, body, NOW)).toEqual({ ok: true });
  });

  it('matches the signature Svix documents for its example', async () => {
    // https://docs.svix.com/receiving/verifying-payloads/how-manual
    const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
    const payload = '{"test": 2432232314}';
    expect(await webhookSignature(secret, 'msg_p5jXN8AQM9LWM0D4loKWxJek', '1614265330', payload)).toBe('g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=');
  });

  it('refuses a changed body, another secret, a stale timestamp and missing headers', async () => {
    const signed = await headers();
    expect(await verifyWebhook(SECRET, signed, body.replace('user_a', 'user_b'), NOW)).toEqual({ ok: false, reason: 'no matching signature' });
    expect(await verifyWebhook(SECRET, await headers(NOW / 1000, `whsec_${Buffer.from('another').toString('base64')}`), body, NOW)).toMatchObject({ ok: false });
    expect(await verifyWebhook(SECRET, await headers(NOW / 1000 - WEBHOOK_TOLERANCE_S - 1), body, NOW)).toEqual({ ok: false, reason: 'timestamp out of tolerance' });
    expect(await verifyWebhook(SECRET, { ...signed, signature: null }, body, NOW)).toEqual({ ok: false, reason: 'missing svix headers' });
    expect(await verifyWebhook(SECRET, { ...signed, signature: signed.signature.replace('v1,', 'v2,') }, body, NOW)).toMatchObject({ ok: false });
  });
});

describe('Clerk webhook endpoint (#250)', () => {
  // Imported here so the module reads the env var set below.
  const { clerkWebhook } = jest.requireActual('../convex/http') as typeof import('../convex/http');
  const call = async (request: Request) => {
    const runMutation = jest.fn().mockResolvedValue({});
    const handler = (clerkWebhook as unknown as { _handler: (ctx: unknown, request: Request) => Promise<Response> })._handler;
    return { response: await handler({ runMutation }, request), runMutation };
  };
  const post = async (payload: string, secret = SECRET) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v1,${await webhookSignature(secret, 'msg_1', timestamp, payload)}`;
    return new Request('https://example.convex.site/clerk/webhook', {
      method: 'POST',
      body: payload,
      headers: { 'svix-id': 'msg_1', 'svix-timestamp': timestamp, 'svix-signature': signature },
    });
  };

  afterEach(() => {
    delete process.env.CLERK_WEBHOOK_SECRET;
  });

  it("deletes a deleted user's data, ignores other events, and refuses unsigned or unconfigured calls", async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await call(await post(body))).response.status).toBe(500);
    process.env.CLERK_WEBHOOK_SECRET = SECRET;
    const deleted = await call(await post(body));
    expect(deleted.response.status).toBe(204);
    expect(deleted.runMutation).toHaveBeenCalledWith(expect.anything(), { userId: 'user_a' });
    const other = await call(await post(JSON.stringify({ type: 'user.updated', data: { id: 'user_a' } })));
    expect(other.response.status).toBe(204);
    expect(other.runMutation).not.toHaveBeenCalled();
    const forged = await call(await post(body, `whsec_${Buffer.from('forged').toString('base64')}`));
    expect(forged.response.status).toBe(400);
    expect(forged.runMutation).not.toHaveBeenCalled();
    // A secret set but unreadable is the deployment's fault: 500, so Clerk retries.
    process.env.CLERK_WEBHOOK_SECRET = 'whsec_not base64!';
    const misconfigured = await call(await post(body));
    expect(misconfigured.response.status).toBe(500);
    expect(misconfigured.runMutation).not.toHaveBeenCalled();
  });
});
