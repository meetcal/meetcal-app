import { isRecord } from './lib/json';
import { httpRouter } from 'convex/server';
import { internal } from './_generated/api';
import { httpAction } from './_generated/server';
import { jwks } from './apiTokens';
import { revenuecatWebhook } from './entitlements';
import { UNREADABLE_SECRET, verifyWebhook } from './lib/webhookSignature';

const http = httpRouter();

export const clerkWebhook = httpAction(async (ctx, request) => {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    console.error('clerk webhook: CLERK_WEBHOOK_SECRET is not set');
    return new Response('webhook not configured', { status: 500 });
  }
  const body = await request.text();
  const verdict = await verifyWebhook(
    secret,
    { id: request.headers.get('svix-id'), timestamp: request.headers.get('svix-timestamp'), signature: request.headers.get('svix-signature') },
    body,
    Date.now(),
  );
  if (!verdict.ok) {
    // A secret that is set but unreadable is this deployment's fault, not
    // the request's: 500, so Clerk retries the event once it is fixed rather
    // than dropping it (a 400 is not retried).
    if (verdict.reason === UNREADABLE_SECRET) {
      console.error('clerk webhook: CLERK_WEBHOOK_SECRET is not a valid whsec_ secret');
      return new Response('webhook not configured', { status: 500 });
    }
    return new Response(verdict.reason, { status: 400 });
  }
  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response('body is not JSON', { status: 400 });
  }
  if (!isRecord(event) || event.type !== 'user.deleted') return new Response(null, { status: 204 });
  const userId = isRecord(event.data) ? event.data.id : undefined;
  if (typeof userId !== 'string' || userId.trim() === '') return new Response('user.deleted without a user id', { status: 400 });
  await ctx.runMutation(internal.users.deleteUserData, { userId });
  return new Response(null, { status: 204 });
});

http.route({ path: '/clerk/webhook', method: 'POST', handler: clerkWebhook });
http.route({ path: '/revenuecat/webhook', method: 'POST', handler: revenuecatWebhook });
http.route({ path: '/.well-known/jwks.json', method: 'GET', handler: jwks });

export default http;
