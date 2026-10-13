/**
 * The premium gate for actions: sign-in first, then the entitlement, and an
 * unknown entitlement never opens the paywall.
 */
import React from "react";
import { act, create } from "react-test-renderer";
import { useRequirePremium } from "@/hooks/useRequirePremium";
import { showToast } from "@/lib/toast";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));

let mockAuthResult: boolean | null = true;
const mockRequireAuth = jest.fn(() => mockAuthResult);
jest.mock("@/utils/authGuard", () => ({
  useAuthGuard: () => ({ requireAuth: mockRequireAuth }),
}));

let mockSubscription: { isSubscribed: boolean | null; isLoading: boolean } = {
  isSubscribed: true,
  isLoading: false,
};
jest.mock("@/contexts/SubscriptionContext", () => ({
  useSubscription: () => mockSubscription,
}));

jest.mock("@/lib/toast", () => ({ showToast: jest.fn() }));
const mockShowToast = showToast as jest.MockedFunction<typeof showToast>;

const OPTIONS = {
  feature: "qualifying-totals",
  message: "Sign in to access premium features.",
  returnPath: "/shared-screens/schedule-details",
};

function mountGate(): ReturnType<typeof useRequirePremium> {
  let captured!: ReturnType<typeof useRequirePremium>;
  function Harness() {
    captured = useRequirePremium();
    return null;
  }
  act(() => {
    create(<Harness />);
  });
  return captured;
}

function run(): boolean {
  return mountGate().requirePremium(OPTIONS);
}

describe("useRequirePremium", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthResult = true;
    mockSubscription = { isSubscribed: true, isLoading: false };
  });

  it("lets a signed-in subscriber through", () => {
    expect(run()).toBe(true);
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("stops at sign-in before looking at the entitlement", () => {
    mockAuthResult = false;
    mockSubscription = { isSubscribed: false, isLoading: false };
    expect(run()).toBe(false);
    expect(mockRequireAuth).toHaveBeenCalledWith(OPTIONS);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("stops quietly when sign-in is undecided (the guard has already said why)", () => {
    mockAuthResult = null;
    expect(run()).toBe(false);
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("opens the paywall with a way back for a free user", () => {
    mockSubscription = { isSubscribed: false, isLoading: false };
    expect(run()).toBe(false);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/shared-screens/paywall",
      params: { from: OPTIONS.returnPath, feature: OPTIONS.feature },
    });
  });

  it.each([
    [true, /checking/i],
    [false, /connect to the internet/i],
  ])(
    "with an unknown entitlement (loading %p), toasts and never opens the paywall",
    (isLoading, message) => {
      mockSubscription = { isSubscribed: null, isLoading };
      expect(run()).toBe(false);
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringMatching(message) }),
      );
    },
  );
});

// #340: one gate for "Add to Calendar" on the Saved tab, the Start List and
// session details.
describe("requireCalendarExport", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthResult = true;
    mockSubscription = { isSubscribed: true, isLoading: false };
  });

  it("lets a signed-in subscriber through", () => {
    expect(mountGate().requireCalendarExport("/(tabs)/(saved)")).toBe(true);
  });

  it("asks a signed-out user to sign in, with the calendar feature", () => {
    mockAuthResult = false;
    expect(mountGate().requireCalendarExport("/(tabs)/(saved)")).toBe(false);
    expect(mockRequireAuth).toHaveBeenCalledWith({
      feature: "add-to-calendar",
      message: "Sign in to add sessions to your calendar.",
      returnPath: "/(tabs)/(saved)",
    });
  });

  it("sends a free user to the paywall and back", () => {
    mockSubscription = { isSubscribed: false, isLoading: false };
    expect(mountGate().requireCalendarExport("/shared-screens/schedule-details?x=1")).toBe(false);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/shared-screens/paywall",
      params: { from: "/shared-screens/schedule-details?x=1", feature: "add-to-calendar" },
    });
  });
});
