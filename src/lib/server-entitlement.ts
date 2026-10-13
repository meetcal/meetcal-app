import { refreshServerEntitlement } from '@/lib/api/meetcal-api';
import { devWarn } from '@/lib/logger';

/**
 * The server decides who reads premium data from its own copy of each
 * user's RevenueCat entitlement (`convex/entitlements.ts`). RevenueCat's
 * webhook keeps it current, but it lands after a purchase does, and a
 * lifetime purchase made before the webhook existed never sends one. So when
 * the app sees an active entitlement it asks the server to check too: once
 * per user per launch, since the server throttles it anyway.
 */

const refreshed = new Set<string>();
const inFlight = new Map<string, Promise<void>>();

/**
 * Asks the server to check `userId`'s entitlement, unless it already did in
 * this process. A failure (offline, no token) is not remembered, so the next
 * active-entitlement answer tries again.
 */
export function refreshServerEntitlementOnce(userId: string, getToken: () => Promise<string | null>): Promise<void> {
  if (refreshed.has(userId)) return Promise.resolve();
  const pending = inFlight.get(userId);
  if (pending) return pending;
  const run = (async () => {
    try {
      const token = await getToken().catch(() => null);
      if (!token) return;
      await refreshServerEntitlement(token);
      refreshed.add(userId);
    } catch (error) {
      devWarn('[entitlement] server refresh failed', error);
    } finally {
      inFlight.delete(userId);
    }
  })();
  inFlight.set(userId, run);
  return run;
}

/** Forgets which users were refreshed. For tests. */
export function resetServerEntitlementRefreshForTests(): void {
  refreshed.clear();
  inFlight.clear();
}
