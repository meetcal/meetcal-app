/**
 * Posts `text` to a Slack webhook. Callers pass `process.env.X` themselves (a
 * static read, which the Expo lint rules require); a missing webhook (every
 * non-production deployment) is a no-op, so dev runs never post to the real
 * channels.
 */
export async function postSlack(webhook: string | undefined, label: string, text: string): Promise<boolean> {
  if (!webhook) {
    console.log(`Slack: no webhook for ${label}; not posting.`);
    return false;
  }
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) console.error(`Slack post for ${label} failed with ${response.status}`);
  return response.ok;
}
