/**
 * Sends an email through OneSignal (`ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY`,
 * the app's email sender). Returns OneSignal's notification id; throws when
 * OneSignal refuses the message, so a failed alert fails the run and shows
 * in the Convex logs.
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<string> {
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
    body: JSON.stringify({ app_id: appId, target_channel: 'email', include_email_tokens: [to], email_subject: subject, email_body: html }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string; errors?: unknown };
  if (!response.ok || !body.id) throw new Error(`OneSignal email failed (${response.status}): ${JSON.stringify(body.errors ?? body)}`);
  return body.id;
}

/** Text for an HTML email body. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
