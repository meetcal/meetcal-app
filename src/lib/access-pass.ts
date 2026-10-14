import { fetchAccessPass, MeetCalApiError, refreshServerEntitlement } from '@/lib/api/meetcal-api';
import type { AccessPass } from '@/lib/api/premium-queries';

/**
 * Gets the shared access pass for the signed-in subscriber. The server knows
 * a subscription from RevenueCat's webhook, which lands after a purchase does
 * and never came for lifetime purchases made before it existed; so when it
 * answers 403 the app asks it to check RevenueCat now
 * (`entitlements:refresh`) and, if it finds the subscription, asks once more.
 * Null when there is no pass to be had: signed out, or not subscribed.
 */
export async function loadAccessPass(getToken: () => Promise<string | null>): Promise<AccessPass | null> {
  const token = await getToken();
  if (!token) return null;
  try {
    return await fetchAccessPass(token);
  } catch (error) {
    if (!(error instanceof MeetCalApiError) || error.status !== 403) throw error;
  }
  const { active } = await refreshServerEntitlement(token);
  return active ? await fetchAccessPass(token) : null;
}
