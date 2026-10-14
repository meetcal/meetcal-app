import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { accessPassFor, setAccessPassSource } from "@/lib/api/premium-queries";
import { loadAccessPass } from "@/lib/access-pass";
import { useServerDataAccess } from "./useServerDataAccess";

const mockAuth = { isLoaded: true as boolean, isSignedIn: true as boolean, userId: "user_a" as string | null, getToken: jest.fn(async () => "clerk-token") };
const mockHint: { state: { isSignedIn: boolean; timestamp: number; userId?: string } | null } = { state: null };
const mockSubscription: { isSubscribed: boolean | null } = { isSubscribed: true };

jest.mock("@clerk/expo", () => ({ useAuth: () => mockAuth }));
jest.mock("@/contexts/SubscriptionContext", () => ({ useSubscription: () => mockSubscription }));
jest.mock("@/lib/authCache", () => ({ getCachedAuthState: jest.fn(async () => mockHint.state) }));
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
  mockAuth.isLoaded = true;
  mockHint.state = null;
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
    await act(async () => {});
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

  it("on a cold start, waits for Clerk while the auth hint says someone is signed in, then fetches once", async () => {
    mockAuth.isLoaded = false;
    mockAuth.isSignedIn = false;
    mockAuth.userId = null;
    mockHint.state = { isSignedIn: true, timestamp: Date.now(), userId: "user_a" };
    render();
    await act(async () => {});
    const pending = accessPassFor("results:byNames");
    // Clerk has not loaded: the pass is not asked for yet.
    expect(loadAccessPass).not.toHaveBeenCalled();
    mockAuth.isLoaded = true;
    mockAuth.isSignedIn = true;
    mockAuth.userId = "user_a";
    render();
    await expect(pending).resolves.toBe("p1");
    expect(loadAccessPass).toHaveBeenCalledTimes(1);
  });

  it("does not wait for Clerk when the hint says nobody is signed in", async () => {
    mockAuth.isLoaded = false;
    mockAuth.isSignedIn = false;
    mockAuth.userId = null;
    render();
    await act(async () => {});
    await expect(accessPassFor("results:byNames")).resolves.toBeUndefined();
  });

  it("forgets the pass when the user changes", async () => {
    render();
    await accessPassFor("results:byNames");
    mockAuth.userId = "user_b";
    render();
    await act(async () => {});
    expect(loadAccessPass).toHaveBeenCalledTimes(2);
  });
});
