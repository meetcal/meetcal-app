import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { accessPassFor, setAccessPassSource } from "@/lib/api/premium-queries";
import { loadAccessPass } from "@/lib/access-pass";
import { useServerDataAccess } from "./useServerDataAccess";

const mockAuth = { isSignedIn: true as boolean, userId: "user_a" as string | null, getToken: jest.fn(async () => "clerk-token") };
const mockSubscription: { isSubscribed: boolean | null } = { isSubscribed: true };

jest.mock("@clerk/expo", () => ({ useAuth: () => mockAuth }));
jest.mock("@/contexts/SubscriptionContext", () => ({ useSubscription: () => mockSubscription }));
jest.mock("@/lib/access-pass", () => ({ loadAccessPass: jest.fn(async () => ({ pass: "p1", rotatesAt: Date.now() + 60_000 })) }));

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
  jest.mocked(loadAccessPass).mockClear();
});

afterEach(() => {
  act(() => tree?.unmount());
  tree = null;
  setAccessPassSource(null);
});

describe("useServerDataAccess", () => {
  it("fetches a subscriber's pass at once, so the first premium read does not wait", async () => {
    render();
    expect(loadAccessPass).toHaveBeenCalledTimes(1);
    await expect(accessPassFor("results:byNames")).resolves.toBe("p1");
    expect(loadAccessPass).toHaveBeenCalledTimes(1);
  });

  it("gives free and signed-out users no pass", async () => {
    mockSubscription.isSubscribed = false;
    render();
    await expect(accessPassFor("results:byNames")).resolves.toBeUndefined();
    mockSubscription.isSubscribed = true;
    mockAuth.isSignedIn = false;
    mockAuth.userId = null;
    render();
    await expect(accessPassFor("results:byNames")).resolves.toBeUndefined();
    expect(loadAccessPass).not.toHaveBeenCalled();
  });

  it("forgets the pass when the user changes", async () => {
    render();
    await accessPassFor("results:byNames");
    mockAuth.userId = "user_b";
    render();
    expect(loadAccessPass).toHaveBeenCalledTimes(2);
  });
});
