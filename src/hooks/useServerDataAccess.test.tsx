import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { dataTokenFor } from "@/lib/api/premium-queries";
import type { ConfirmedEntitlement } from "@/lib/confirmed-entitlement";
import { refreshServerEntitlementOnce } from "@/lib/server-entitlement";
import { useServerDataAccess } from "./useServerDataAccess";

const mockAuth = { isSignedIn: true as boolean, userId: "user_a" as string | null, getToken: jest.fn(async () => "clerk-token") };
const mockSubscription: { isSubscribed: boolean | null; confirmedEntitlement: ConfirmedEntitlement | null } = {
  isSubscribed: true,
  confirmedEntitlement: null,
};

jest.mock("@clerk/expo", () => ({ useAuth: () => mockAuth }));
jest.mock("@/contexts/SubscriptionContext", () => ({ useSubscription: () => mockSubscription }));
jest.mock("@/lib/server-entitlement", () => ({ refreshServerEntitlementOnce: jest.fn(async () => {}) }));

function Harness() {
  useServerDataAccess();
  return null;
}

let tree: ReactTestRenderer | null = null;
const render = () =>
  act(() => {
    if (tree) tree.update(<Harness />);
    else tree = create(<Harness />);
  });

beforeEach(() => {
  mockAuth.isSignedIn = true;
  mockAuth.userId = "user_a";
  mockSubscription.isSubscribed = true;
  mockSubscription.confirmedEntitlement = null;
  jest.mocked(refreshServerEntitlementOnce).mockClear();
});

afterEach(() => {
  act(() => tree?.unmount());
  tree = null;
});

describe("useServerDataAccess", () => {
  it("leaves a free user's reads anonymous, so they keep sharing the server's cache", async () => {
    mockSubscription.isSubscribed = false;
    render();
    await expect(dataTokenFor("results:byNames")).resolves.toBeUndefined();
    mockSubscription.isSubscribed = true;
    render();
    await expect(dataTokenFor("results:byNames")).resolves.toBe("clerk-token");
  });

  it("gives a subscriber's premium reads their token, and takes it back on sign-out", async () => {
    render();
    await expect(dataTokenFor("results:byNames")).resolves.toBe("clerk-token");
    mockAuth.isSignedIn = false;
    mockAuth.userId = null;
    render();
    await expect(dataTokenFor("results:byNames")).resolves.toBeUndefined();
  });

  it("asks the server to check a subscription RevenueCat confirmed for this user", () => {
    mockSubscription.confirmedEntitlement = { appUserId: "user_a", isSubscribed: true };
    render();
    expect(refreshServerEntitlementOnce).toHaveBeenCalledWith("user_a", expect.any(Function));
  });

  it("does not for another account's answer, a free user, or the dev simulation", () => {
    mockSubscription.confirmedEntitlement = { appUserId: "user_b", isSubscribed: true };
    render();
    mockSubscription.confirmedEntitlement = { appUserId: "user_a", isSubscribed: false };
    render();
    mockSubscription.confirmedEntitlement = { appUserId: null, isSubscribed: true, simulated: true };
    render();
    expect(refreshServerEntitlementOnce).not.toHaveBeenCalled();
  });
});
