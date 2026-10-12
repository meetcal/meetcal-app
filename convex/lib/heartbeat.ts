/**
 * The external dead man's switch. After each watchdog run that checked every
 * job and sent every alert, the backend pings `HEARTBEAT_URL` (a
 * Healthchecks.io check, Better Stack heartbeat or similar: a plain GET). The
 * monitor alerts when the pings stop, which catches what no alert from the
 * backend can: the crons stopped, the watchdog keeps failing, or alert email
 * itself broke. Without `HEARTBEAT_URL` (the dev deployment) nothing is sent.
 */

/** A ping that has not answered in this long is given up on; the monitor's grace period covers a late one. */
export const HEARTBEAT_TIMEOUT_MS = 10_000;

/**
 * Pings `url` when set. Never throws: a failed ping is logged and left to the
 * monitor, which alerts on the missing ping itself, rather than failing the
 * watchdog and sending a second alert about the same thing. Returns whether
 * the ping was answered with success.
 */
export async function pingHeartbeat(url: string | undefined, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!url) return false;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS) });
    if (response.ok) return true;
    console.error(`heartbeat ping failed with ${response.status}`);
  } catch (error) {
    console.error(`heartbeat ping failed: ${(error as Error).message}`);
  }
  return false;
}
