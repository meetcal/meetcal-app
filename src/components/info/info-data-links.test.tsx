/**
 * The Info tab's links into premium data screens. A signed-out tap goes
 * through sign-in, which must come back to the screen that was tapped (whose
 * `SubscriptionGate` shows the paywall), not to the Info tab. The feature
 * names must stay out of the premium-intent list, or sign-in also pushes a
 * routed paywall over it.
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import InfoScreen from "@/app/(tabs)/(info)/index";
import { isPremiumFeature } from "@/lib/premium-intent";
import { isInternalRoutePath } from "@/utils/deepLinks";

const mockRequireAuth = jest.fn<boolean | null, [Record<string, unknown>]>(() => false);
jest.mock("@/utils/authGuard", () => ({
  useAuthGuard: () => ({ requireAuth: mockRequireAuth }),
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/components/info/EventInfoScreen", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/schedule/OnboardingView", () => ({
  OnboardingView: () => null,
  resetOnboarding: jest.fn(),
}));
jest.mock("@/components/schedule/VersionAnnouncement", () => ({
  VersionAnnouncement: () => null,
  resetVersionAnnouncement: jest.fn(),
}));
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));
jest.mock("@/components/ui/Toast", () => ({ showToast: jest.fn() }));
jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("@/config/dev-mock-meet", () => ({
  enableMockMeetData: jest.fn(),
  disableMockMeetData: jest.fn(),
}));
jest.mock("@/contexts/SelectedMeetContext", () => ({
  useSelectedMeet: () => ({ selectedMeet: null, setSelectedMeet: jest.fn() }),
}));
jest.mock("@/hooks/useScreenInsets", () => ({
  useScreenHorizontalInsets: () => ({ paddingLeft: 0, paddingRight: 0 }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@sentry/react-native", () => ({ captureException: jest.fn() }));

const GATED_LINKS = [
  "info-adaptive-records",
  "info-all-meet-results",
  "info-club-meet-results",
  "info-national-rankings",
  "info-records",
  "info-wso-records",
  "info-qualifying-totals",
  "info-standards",
  "info-international-rankings",
];

function pressLink(renderer: ReactTestRenderer, testID: string): void {
  const [button] = renderer.root.findAll(
    (node) => node.props.testID === testID && typeof node.props.onPress === "function",
  );
  if (!button) throw new Error(`No link ${testID}`);
  act(() => {
    button.props.onPress();
  });
}

describe("Info tab data links", () => {
  let renderer: ReactTestRenderer;

  beforeEach(() => {
    jest.clearAllMocks();
    act(() => {
      renderer = create(<InfoScreen />);
    });
  });

  it.each(GATED_LINKS)("%s signs in back to the tapped screen, not the Info tab", (testID) => {
    mockRequireAuth.mockReturnValueOnce(true);
    pressLink(renderer, testID);

    expect(mockPush).toHaveBeenCalledTimes(1);
    const pushed = mockPush.mock.calls[0][0];
    const options = mockRequireAuth.mock.calls[0][0];
    expect(options.returnPath).toBe(pushed);
    expect(isInternalRoutePath(options.returnPath)).toBe(true);
  });

  it.each(GATED_LINKS)("%s does not also queue a routed paywall after sign-in", (testID) => {
    pressLink(renderer, testID);

    expect(mockPush).not.toHaveBeenCalled();
    const options = mockRequireAuth.mock.calls[0][0];
    expect(isPremiumFeature(options.feature)).toBe(false);
  });
});
