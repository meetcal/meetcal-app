import React from "react";
import { Alert } from "react-native";
import { act, create } from "react-test-renderer";
import { useAuthGuard } from "@/utils/authGuard";
import { useUser } from "@clerk/clerk-expo";
import { useRouter } from "expo-router";
import { getCachedAuthState } from "@/lib/authCache";
import { isNetworkAvailable } from "@/lib/networkUtils";

jest.mock("@clerk/clerk-expo", () => ({
  useUser: jest.fn(),
}));

jest.mock("expo-router", () => ({
  useRouter: jest.fn(),
}));

jest.mock("@/lib/authCache", () => ({
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

    await act(async () => {
      create(<Harness />);
    });

    const result = captured?.requireAuth({
      feature: "athlete-results",
    });

    expect(result).toBe(true);
    expect(alertSpy).not.toHaveBeenCalled();
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
});
