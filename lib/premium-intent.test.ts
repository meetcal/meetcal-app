import type { CustomerInfo } from "react-native-purchases";
import {
  PREMIUM_INTENT_TTL_MS,
  confirmRevenueCatIdentity,
  forgetRevenueCatIdentity,
  hasSubscriptionEntitlement,
  paywallRouteFor,
  recordPremiumIntent,
  resetPremiumIntentState,
} from "@/lib/premium-intent";

// The dev config simulates a subscription in `__DEV__`; tests use real
// CustomerInfo unless they opt in.
const mockSimulated = { value: null as boolean | null };
jest.mock("@/config/development", () => ({
  getSimulatedSubscriptionStatus: () => mockSimulated.value,
}));

const T0 = 1_000_000;
const QT = { userId: "user_1", feature: "qualifying-totals", from: "/shared-screens/schedule-details" };

function customerInfo(active: Record<string, unknown>): CustomerInfo {
  return { entitlements: { active } } as unknown as CustomerInfo;
}

describe("premium intent across sign-in", () => {
  beforeEach(() => {
    resetPremiumIntentState();
    mockSimulated.value = null;
  });

  it("opens the paywall for a free user only once RevenueCat confirms the signed-in user", () => {
    expect(recordPremiumIntent(QT, T0)).toBeNull();

    expect(confirmRevenueCatIdentity("user_1", false, T0 + 500)).toEqual({
      feature: "qualifying-totals",
      from: "/shared-screens/schedule-details",
    });
    // Consumed: a later CustomerInfo for the same user does not reopen it.
    expect(confirmRevenueCatIdentity("user_1", false, T0 + 600)).toBeNull();
  });

  it("decides at sign-in when logIn already resolved for this user", () => {
    confirmRevenueCatIdentity("user_1", false, T0);

    expect(recordPremiumIntent(QT, T0 + 10)).toEqual({
      feature: "qualifying-totals",
      from: "/shared-screens/schedule-details",
    });
  });

  it("drops the intent for a subscriber", () => {
    recordPremiumIntent(QT, T0);

    expect(confirmRevenueCatIdentity("user_1", true, T0 + 500)).toBeNull();
    // Dropped, not parked: a later "free" answer does not revive it.
    expect(confirmRevenueCatIdentity("user_1", false, T0 + 600)).toBeNull();
  });

  it.each([
    undefined,
    "",
    "save-session",
    "profile",
    ["qualifying-totals"],
    // Screen-level gates render their own paywall at `from`.
    "subscription",
    "offline-data",
    "records",
  ])(
    "never opens the paywall for feature=%p",
    (feature) => {
      expect(recordPremiumIntent({ ...QT, feature }, T0)).toBeNull();
      expect(confirmRevenueCatIdentity("user_1", false, T0 + 1)).toBeNull();
    },
  );

  it("drops the intent when identity never confirms within the expiry", () => {
    recordPremiumIntent(QT, T0);

    expect(
      confirmRevenueCatIdentity("user_1", false, T0 + PREMIUM_INTENT_TTL_MS + 1),
    ).toBeNull();
    expect(confirmRevenueCatIdentity("user_1", false, T0 + 1)).toBeNull();
  });

  it("ignores a stale pre-logIn 'free' entitlement for another RevenueCat user", () => {
    // Anonymous RevenueCat user from before sign-in, reported as free.
    confirmRevenueCatIdentity("$RCAnonymousID:abc", false, T0);

    expect(recordPremiumIntent(QT, T0 + 1)).toBeNull();

    // The switch starts: nothing is known about the new user yet.
    forgetRevenueCatIdentity();
    expect(recordPremiumIntent(QT, T0 + 2)).toBeNull();

    // logIn resolves: this user is a subscriber.
    expect(confirmRevenueCatIdentity("user_1", true, T0 + 3)).toBeNull();
  });

  it("does not open a paywall for a different signed-in user", () => {
    recordPremiumIntent(QT, T0);

    expect(confirmRevenueCatIdentity("user_2", false, T0 + 1)).toBeNull();
  });

  it("keeps one slot: a newer intent replaces the older", () => {
    recordPremiumIntent(QT, T0);
    recordPremiumIntent({ ...QT, feature: "attempt-estimator" }, T0 + 1);

    expect(confirmRevenueCatIdentity("user_1", false, T0 + 2)).toMatchObject({
      feature: "attempt-estimator",
    });
    expect(confirmRevenueCatIdentity("user_1", false, T0 + 3)).toBeNull();
  });

  it("falls back to the tabs for an external return path", () => {
    recordPremiumIntent({ ...QT, from: "https://evil.example" }, T0);

    const intent = confirmRevenueCatIdentity("user_1", false, T0 + 1);
    expect(intent && paywallRouteFor(intent)).toEqual({
      pathname: "/shared-screens/paywall",
      params: { from: "/(tabs)", feature: "qualifying-totals" },
    });
  });

  it("reads the premium entitlement from CustomerInfo", () => {
    expect(hasSubscriptionEntitlement(customerInfo({ Subscriptions: {} }))).toBe(true);
    expect(hasSubscriptionEntitlement(customerInfo({}))).toBe(false);
    expect(hasSubscriptionEntitlement(customerInfo({ Other: {} }))).toBe(false);
  });

  it("honours the dev subscription simulation like the subscription context", () => {
    mockSimulated.value = false;
    expect(hasSubscriptionEntitlement(customerInfo({ Subscriptions: {} }))).toBe(false);
  });
});
