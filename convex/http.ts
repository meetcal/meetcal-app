import { httpRouter } from 'convex/server';
import { internal } from './_generated/api';
import { httpAction } from './_generated/server';
import { UNREADABLE_SECRET, verifyWebhook } from './lib/webhookSignature';

const http = httpRouter();

/**
 * Clerk's webhooks (Svix-signed with `CLERK_WEBHOOK_SECRET`). On
 * `user.deleted`, deletes everything stored under the user's id: their saved
 * sessions (with notes and athlete names), preferences and saved-session
 * write-order records (`users.deleteUserData`). Account deletion happens in
 * Clerk, which the app cannot follow up on once the account is gone (#250).
 * Other event types are acknowledged and ignored. Configure in the Clerk
 * dashboard: endpoint `https://<deployment>.convex.site/clerk/webhook`,
 * event `user.deleted`; then `npx convex env set CLERK_WEBHOOK_SECRET whsec_…`.
 */
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
  const type = typeof event === 'object' && event !== null ? (event as { type?: unknown }).type : undefined;
  if (type !== 'user.deleted') return new Response(null, { status: 204 });
  const data = (event as { data?: unknown }).data;
  const userId = typeof data === 'object' && data !== null ? (data as { id?: unknown }).id : undefined;
  if (typeof userId !== 'string' || userId.trim() === '') return new Response('user.deleted without a user id', { status: 400 });
  await ctx.runMutation(internal.users.deleteUserData, { userId });
  return new Response(null, { status: 204 });
});

http.route({ path: '/clerk/webhook', method: 'POST', handler: clerkWebhook });

export default http;
