import { isRecord } from './json';

export const EMAIL_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;

export async function sendEmail(to: string, subject: string, html: string, options: { replyTo?: string } = {}): Promise<string> {
  const appId = process.env.ONESIGNAL_APP_ID;
  const key = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !key) throw new Error('ONESIGNAL_APP_ID and ONESIGNAL_REST_API_KEY must be set to send email');
  const response = await fetch('https://api.onesignal.com/notifications?c=email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Current keys use `Key`; keys from before OneSignal's 2024 change use `Basic`.
      Authorization: key.startsWith('os_') ? `Key ${key}` : `Basic ${key}`,
    },
    body: JSON.stringify({
      app_id: appId,
      target_channel: 'email',
      include_email_tokens: [to],
      email_subject: subject,
      email_body: html,
      ...(options.replyTo ? { email_reply_to_address: options.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body: unknown = await response.json().catch(() => ({}));
  const id = isRecord(body) && typeof body.id === 'string' ? body.id : '';
  if (!response.ok || id === '') throw new Error(`OneSignal email failed (${response.status}): ${JSON.stringify(isRecord(body) ? (body.errors ?? body) : body)}`);
  return id;
}

/** Text for an HTML email body. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
