import type { CustomerInfo } from "react-native-purchases";
import { getSimulatedSubscriptionStatus } from "@/config/development";
import { isInternalRoutePath } from "@/utils/deepLinks";

/**
 * A signed-out tap on a premium action goes through sign-in first. The
 * paywall that tap was headed for must survive sign-in, but it may only be
 * decided once RevenueCat describes the *signed-in* user: until
 * `Purchases.logIn` resolves, the subscription context still holds the
 * anonymous user's entitlement, and a subscriber on a fresh install reads as
 * "free". So sign-in records the intent here, `app/_layout.tsx` reports the
 * RevenueCat identity once `logIn` resolves, and whichever lands second
 * decides. One slot; a newer intent replaces an older one.
 */

/** RevenueCat entitlement that unlocks every premium feature. */
export const SUBSCRIPTION_ENTITLEMENT_ID = "Subscriptions";

/**
 * How long a recorded intent waits for RevenueCat to confirm the signed-in
 * user. `logIn` is one round trip; past this the user has moved on and a
 * paywall appearing out of nowhere would be the bigger surprise.
 */
export const PREMIUM_INTENT_TTL_MS = 30_000;

const DEFAULT_PAYWALL_FROM = "/(tabs)";

/**
 * Premium *actions* whose sign-in prompt stands in front of the paywall.
 * Sign-in also runs for free actions (saving a session, opening the profile),
 * which must never end on a paywall. Screen-level gates (`SubscriptionGate`,
 * the Offline Data screen, the Info tab's links into them, the paywall's own
 * sign-in redirect with feature "subscription") are left out on purpose:
 * sign-in returns to the gated screen, which renders the paywall itself, and
 * pushing another one on top would show it twice.
 */
const PREMIUM_FEATURES: ReadonlySet<string> = new Set([
  "qualifying-totals",
  "attempt-estimator",
  "sort-athletes",
  "session-reminders",
  "add-to-calendar",
  "auto-unsave-started-sessions",
  "athlete-bests",
  "athlete-results",
  "share-schedule-image",
  "export-csv",
]);

export interface PremiumIntent {
  feature: string;
  from: string;
}

interface PendingIntent extends PremiumIntent {
  userId: string;
  recordedAt: number;
}

interface ConfirmedIdentity {
  appUserId: string;
  isSubscribed: boolean;
}

let pending: PendingIntent | null = null;
let confirmed: ConfirmedIdentity | null = null;

export function isPremiumFeature(feature: unknown): feature is string {
  return typeof feature === "string" && PREMIUM_FEATURES.has(feature);
}

/** Whether RevenueCat's CustomerInfo carries the premium entitlement. */
export function hasSubscriptionEntitlement(info: CustomerInfo): boolean {
  const simulated = getSimulatedSubscriptionStatus();
  if (simulated !== null) return simulated;
  return info.entitlements.active[SUBSCRIPTION_ENTITLEMENT_ID] != null;
}

/**
 * Decide the pending intent if both halves are in. Returns the paywall to
 * open, or null. The slot is consumed on any decision, and dropped once it
 * is older than {@link PREMIUM_INTENT_TTL_MS}.
 */
function settle(now: number): PremiumIntent | null {
  if (!pending) return null;
  if (now - pending.recordedAt > PREMIUM_INTENT_TTL_MS) {
    pending = null;
    return null;
  }
  if (!confirmed || confirmed.appUserId !== pending.userId) return null;

  const { feature, from } = pending;
  pending = null;
  return confirmed.isSubscribed ? null : { feature, from };
}

/**
 * Sign-in finished for `userId`. Remembers the premium action that sent the
 * user there, and returns the paywall to open now if RevenueCat already
 * confirmed this user. A free feature, or none, clears the slot.
 */
export function recordPremiumIntent(
  intent: { userId: string | null | undefined; feature: unknown; from: unknown },
  now: number = Date.now(),
): PremiumIntent | null {
  if (!intent.userId || !isPremiumFeature(intent.feature)) {
    pending = null;
    return null;
  }
  pending = {
    userId: intent.userId,
    feature: intent.feature,
    from: isInternalRoutePath(intent.from) ? intent.from : DEFAULT_PAYWALL_FROM,
    recordedAt: now,
  };
  return settle(now);
}

/**
 * `Purchases.logIn(appUserId)` resolved with this entitlement. Returns the
 * paywall to open if an intent from this user's sign-in is waiting.
 */
export function confirmRevenueCatIdentity(
  appUserId: string,
  isSubscribed: boolean,
  now: number = Date.now(),
): PremiumIntent | null {
  confirmed = { appUserId, isSubscribed };
  return settle(now);
}

/**
 * RevenueCat is switching users (or logging out). Until the next `logIn`
 * resolves, nothing it says describes the signed-in user.
 */
export function forgetRevenueCatIdentity(): void {
  confirmed = null;
}

/** Test seam: module state outlives a test otherwise. */
export function resetPremiumIntentState(): void {
  pending = null;
  confirmed = null;
}

export function paywallRouteFor(intent: PremiumIntent) {
  return {
    pathname: "/shared-screens/paywall" as const,
    params: { from: intent.from, feature: intent.feature },
  };
}
