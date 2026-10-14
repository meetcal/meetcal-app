/**
 * Verifies a Svix-signed webhook, as Clerk sends them
 * (https://docs.svix.com/receiving/verifying-payloads/how-manual): the
 * `svix-signature` header holds space-separated `v1,<base64>` signatures,
 * each an HMAC-SHA256 of `${svix-id}.${svix-timestamp}.${body}` keyed with
 * the base64 secret after `whsec_`. A timestamp further than
 * WEBHOOK_TOLERANCE_S from now is refused, so a captured request cannot be
 * replayed later. Web Crypto only, so it runs in Convex's default runtime.
 */

/** How far a webhook's timestamp may be from the server's clock. */
export const WEBHOOK_TOLERANCE_S = 5 * 60;

export type WebhookHeaders = { id: string | null; timestamp: string | null; signature: string | null };

export type WebhookVerdict = { ok: true } | { ok: false; reason: string };

/** The verdict's reason when the configured secret cannot be decoded (a deployment fault, not the request's). */
export const UNREADABLE_SECRET = 'unreadable webhook secret';

function base64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Equal strings, compared in time that does not depend on where they differ. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function webhookSignature(secret: string, id: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    base64ToBytes(secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return bytesToBase64(new Uint8Array(signed));
}

export async function verifyWebhook(secret: string, headers: WebhookHeaders, body: string, nowMs: number): Promise<WebhookVerdict> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing svix headers' };
  const seconds = Number(timestamp);
  if (!/^\d+$/.test(timestamp) || Math.abs(nowMs / 1000 - seconds) > WEBHOOK_TOLERANCE_S) return { ok: false, reason: 'timestamp out of tolerance' };
  let expected: string;
  try {
    expected = await webhookSignature(secret, id, timestamp, body);
  } catch {
    return { ok: false, reason: UNREADABLE_SECRET };
  }
  const matches = signature
    .split(' ')
    .map((part) => part.split(','))
    .some(([version, value]) => version === 'v1' && value !== undefined && constantTimeEqual(value, expected));
  return matches ? { ok: true } : { ok: false, reason: 'no matching signature' };
}
