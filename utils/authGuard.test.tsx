import React from "react";
import { Alert } from "react-native";
import { act, create } from "react-test-renderer";
import { useAuthGuard } from "@/utils/authGuard";
import { useUser } from "@clerk/expo";
import { useRouter } from "expo-router";
import { cacheAuthState, getCachedAuthState } from "@/lib/authCache";
import { isNetworkAvailable } from "@/lib/networkUtils";

jest.mock("@clerk/expo", () => ({
  useUser: jest.fn(),
}));

jest.mock("expo-router", () => ({
  useRouter: jest.fn(),
}));

jest.mock("@/lib/authCache", () => ({
  cacheAuthState: jest.fn(),
  getCachedAuthState: jest.fn(),
}));

jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(),
}));

const mockUseUser = useUser as jest.MockedFunction<typeof useUser>;
const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockGetCachedAuthState = getCachedAuthState as jest.MockedFunction<
  typeof getCachedAuthState
>;
const mockCacheAuthState = cacheAuthState as jest.MockedFunction<
  typeof cacheAuthState
>;
const mockIsNetworkAvailable = isNetworkAvailable as jest.MockedFunction<
  typeof isNetworkAvailable
>;

describe("useAuthGuard offline behavior", () => {
  const push = jest.fn();
  let captured: ReturnType<typeof useAuthGuard> | null = null;
  let alertSpy: jest.SpyInstance;

  function Harness() {
    captured = useAuthGuard();
    return null;
  }

  const flushEffects = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    captured = null;
    push.mockReset();
    jest.clearAllMocks();
    mockUseRouter.mockReturnValue({ push } as any);
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it("authenticates from cache while offline when Clerk is not loaded", async () => {
    mockUseUser.mockReturnValue({ user: null, isLoaded: false } as any);
    mockGetCachedAuthState.mockResolvedValue({
      isSignedIn: true,
      timestamp: Date.now(),
    });
    mockIsNetworkAvailable.mockResolvedValue(false);

    await act(async () => {
      create(<Harness />);
    });
    await flushEffects();

    const result = captured?.requireAuth({
      feature: "athlete-results",
      returnPath: "/shared-screens/schedule-details",
    });

    expect(result).toBe(true);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("returns true when Clerk user exists", async () => {
    mockUseUser.mockReturnValue({ user: { id: "123" }, isLoaded: true } as any);
    mockGetCachedAuthState.mockResolvedValue(null);
    mockIsNetworkAvailable.mockResolvedValue(true);
    mockCacheAuthState.mockResolvedValue(undefined);

    await act(async () => {
      create(<Harness />);
    });
    await flushEffects();

    const result = captured?.requireAuth({
      feature: "athlete-results",
    });

    expect(result).toBe(true);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockCacheAuthState).toHaveBeenCalledWith(true, "123");
  });

  it("prompts sign in when Clerk is loaded and online, even with a cached sign-in", async () => {
    // Session revoked elsewhere: Clerk has loaded and says "no user", and the
    // device is online, so the SecureStore hint must not open the gate.
    mockUseUser.mockReturnValue({ user: null, isLoaded: true } as any);
    mockGetCachedAuthState.mockResolvedValue({
      isSignedIn: true,
      timestamp: Date.now(),
      userId: "123",
    });
    mockIsNetworkAvailable.mockResolvedValue(true);
    mockCacheAuthState.mockResolvedValue(undefined);

    await act(async () => {
      create(<Harness />);
    });
    await flushEffects();

    const result = captured?.requireAuth({ feature: "saved-sessions" });

    expect(result).toBe(false);
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it("prompts sign in when unauthenticated and no cache", async () => {
    mockUseUser.mockReturnValue({ user: null, isLoaded: true } as any);
    mockGetCachedAuthState.mockResolvedValue(null);
    mockIsNetworkAvailable.mockResolvedValue(true);

    await act(async () => {
      create(<Harness />);
    });
    await flushEffects();

    const result = captured?.requireAuth({
      feature: "attempt-estimator",
      returnPath: "/shared-screens/schedule-details",
    });

    expect(result).toBe(false);
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });
  it("fails closed when the SecureStore read and the network probe both throw", async () => {
    // The probe fails open to "online", so Clerk's "no user" is authoritative
    // and a lost cache read cannot let the caller through.
    mockUseUser.mockReturnValue({ user: null, isLoaded: true } as any);
    mockGetCachedAuthState.mockRejectedValue(new Error("keychain unavailable"));
    mockIsNetworkAvailable.mockRejectedValue(new Error("netinfo crashed"));

    await act(async () => {
      create(<Harness />);
    });
    await flushEffects();

    expect(captured?.requireAuth({ feature: "saved-sessions" })).toBe(false);
    expect(alertSpy).toHaveBeenCalledTimes(1);
    // Nothing verified, so nothing is written over the cache.
    expect(mockCacheAuthState).not.toHaveBeenCalled();
  });

  it("does not overwrite a cached sign-in with signed-out while Clerk answers offline", async () => {
    // Clerk can report loaded-with-no-user offline. Persisting that would lock
    // the user out of their saved sessions the next time they open offline.
    mockUseUser.mockReturnValue({ user: null, isLoaded: true } as any);
    mockGetCachedAuthState.mockResolvedValue({
      isSignedIn: true,
      timestamp: Date.now(),
      userId: "123",
    });
    mockIsNetworkAvailable.mockResolvedValue(false);

    await act(async () => {
      create(<Harness />);
    });
    await flushEffects();

    expect(captured?.requireAuth({ feature: "saved-sessions" })).toBe(true);
    expect(mockCacheAuthState).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("records a verified sign-out when Clerk is loaded, online and has no user", async () => {
    mockUseUser.mockReturnValue({ user: null, isLoaded: true } as any);
    mockGetCachedAuthState.mockResolvedValue(null);
    mockIsNetworkAvailable.mockResolvedValue(true);
    mockCacheAuthState.mockResolvedValue(undefined);

    await act(async () => {
      create(<Harness />);
    });
    await flushEffects();

    expect(mockCacheAuthState).toHaveBeenCalledWith(false);
  });

  it("sends the Sign In button to the typed sign-in route with the return path", async () => {
    mockUseUser.mockReturnValue({ user: null, isLoaded: true } as any);
    mockGetCachedAuthState.mockResolvedValue(null);
    mockIsNetworkAvailable.mockResolvedValue(true);

    await act(async () => {
      create(<Harness />);
    });
    await flushEffects();

    captured?.requireAuth({
      feature: "attempt-estimator",
      message: "Sign in to estimate attempts.",
      returnPath: "/shared-screens/schedule-details",
    });
    captured?.requireAuth({ feature: "saved-sessions" });

    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe("Sign In Required");
    expect(message).toBe("Sign in to estimate attempts.");
    const signIn = (buttons as { text: string; onPress?: () => void }[]).find(
      (button) => button.text === "Sign In",
    );
    signIn?.onPress?.();
    expect(push).toHaveBeenCalledWith({
      pathname: "/(auth)/sign-in",
      params: { from: "/shared-screens/schedule-details", feature: "attempt-estimator" },
    });

    // No return path: back to the tabs, with the default message.
    const [, defaultMessage, defaultButtons] = alertSpy.mock.calls[1];
    expect(defaultMessage).toBe("You need to sign in to use this feature.");
    (defaultButtons as { text: string; onPress?: () => void }[])
      .find((button) => button.text === "Sign In")
      ?.onPress?.();
    expect(push).toHaveBeenLastCalledWith({
      pathname: "/(auth)/sign-in",
      params: { from: "/(tabs)", feature: "saved-sessions" },
    });
  });
});
