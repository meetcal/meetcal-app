/**
 * The profile screen's Sign Out and Submit Feedback wiring: Clerk signs out
 * before the offline sign-in hint is forgotten, a double tap signs out once,
 * a failed sign-out keeps the hint and the screen, success pops back to the
 * running tabs, and a missing mail app gets an alert.
 */
import React from "react";
import { Alert, Linking, Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import ProfileScreen from "@/app/schedule-toolbar/profile";
import { NO_MAIL_APP_ALERT } from "@/lib/profile-actions";

const mockCalls: string[] = [];
const mockSignOut = jest.fn();
const mockClearAuthCache = jest.fn();
const mockShowToast = jest.fn();
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  dismissTo: jest.fn((href: string) => mockCalls.push(`dismissTo ${href}`)),
};

jest.mock("@clerk/expo", () => ({
  useClerk: () => ({ signOut: mockSignOut }),
  useUser: () => ({ user: { id: "user_1", firstName: null, lastName: null } }),
}));
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  usePathname: () => "/schedule-toolbar/profile",
  useRouter: () => mockRouter,
}));
jest.mock("expo-application", () => ({
  nativeApplicationVersion: "2.0.0",
  nativeBuildVersion: "42",
}));
jest.mock("expo-updates", () => ({ updateId: null }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/hooks/useScreenInsets", () => ({ useScreenHorizontalInsets: () => ({}) }));
jest.mock("@/lib/authCache", () => ({
  clearAuthCache: () => mockClearAuthCache(),
}));
jest.mock("@/components/ui/Toast", () => ({
  showToast: (toast: unknown) => mockShowToast(toast),
}));
jest.mock("@/contexts/SubscriptionContext", () => ({
  useSubscription: () => ({ isSubscribed: false, subscriptionType: "free", isLoading: false }),
}));
jest.mock("@/contexts/SelectedMeetContext", () => ({
  useSelectedMeet: () => ({ forceSync: jest.fn(), refreshAvailableMeets: jest.fn() }),
}));
jest.mock("@/utils/authGuard", () => ({ useAuthGuard: () => ({ requireAuth: jest.fn() }) }));
jest.mock("@/lib/database/clear-cache", () => ({
  clearCachedMeetData: jest.fn(),
  clearCacheToast: jest.fn(),
}));
jest.mock("@/components/profile/NotificationSettings", () => ({ NotificationSettings: () => null }));
jest.mock("@/components/profile/AutoUnsaveSetting", () => ({ AutoUnsaveSetting: () => null }));
jest.mock("@/components/profile/AndroidCalendarSetting", () => ({
  AndroidCalendarSetting: () => null,
}));
jest.mock("@/components/profile/ClerkAccountModal", () => ({ ClerkAccountModal: () => null }));
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));
jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function mount(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<ProfileScreen />);
  });
  return renderer;
}

/** The nearest pressable ancestor of the text `label`. */
function pressableFor(renderer: ReactTestRenderer, label: string) {
  const text = renderer.root
    .findAllByType(Text)
    .find((node) => node.props.children === label);
  if (!text) throw new Error(`No ${label}`);
  let node = text.parent;
  while (node && typeof node.props.onPress !== "function") node = node.parent;
  if (!node) throw new Error(`No pressable for ${label}`);
  return node;
}

describe("Profile Sign Out", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCalls.length = 0;
    mockSignOut.mockImplementation(async () => {
      mockCalls.push("signOut");
    });
    mockClearAuthCache.mockImplementation(async () => {
      mockCalls.push("clearAuthCache");
    });
  });

  it("signs out of Clerk once, then forgets the hint, then pops back to the tabs", async () => {
    let finishSignOut!: () => void;
    mockSignOut.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSignOut = () => {
            mockCalls.push("signOut");
            resolve();
          };
        }),
    );
    const renderer = await mount();
    const button = pressableFor(renderer, "Sign Out");

    await act(async () => {
      void button.props.onPress();
      void button.props.onPress();
    });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    // The spinner replaces the label while Clerk works.
    expect(renderer.root.findAllByType(Text).some((node) => node.props.children === "Sign Out")).toBe(false);

    await act(async () => {
      finishSignOut();
    });
    await flush();

    expect(mockCalls).toEqual(["signOut", "clearAuthCache", "dismissTo /(tabs)/(index)"]);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it("keeps the hint and the screen when Clerk fails, and lets the user retry", async () => {
    mockSignOut.mockRejectedValueOnce(new Error("network"));
    jest.spyOn(console, "error").mockImplementation(() => {});
    const renderer = await mount();

    await act(async () => {
      await pressableFor(renderer, "Sign Out").props.onPress();
    });

    expect(mockClearAuthCache).not.toHaveBeenCalled();
    expect(mockRouter.dismissTo).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", message: "Failed to sign out. Please try again." }),
    );

    await act(async () => {
      await pressableFor(renderer, "Sign Out").props.onPress();
    });
    expect(mockSignOut).toHaveBeenCalledTimes(2);
    expect(mockRouter.dismissTo).toHaveBeenCalledWith("/(tabs)/(index)");
  });
});

describe("Profile Submit Feedback", () => {
  it("says where to write when no mail app takes the link", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const openURL = jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("no handler"));
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const renderer = await mount();

    await act(async () => {
      pressableFor(renderer, "Submit Feedback").props.onPress();
    });
    await flush();

    const url = String(openURL.mock.calls[0]?.[0]);
    expect(url).toMatch(/^mailto:/);
    expect(decodeURIComponent(url)).toContain("App Version: 2.0.0 (42)");
    expect(decodeURIComponent(url)).not.toContain("null null");
    expect(alert).toHaveBeenCalledWith(NO_MAIL_APP_ALERT.title, NO_MAIL_APP_ALERT.message);
  });
});

describe("Profile Submit a Meet", () => {
  it("opens the form for sending a meet MeetCal does not cover", async () => {
    const renderer = await mount();
    mockRouter.push.mockClear();

    await act(async () => {
      pressableFor(renderer, "Submit a Meet").props.onPress();
    });

    expect(mockRouter.push).toHaveBeenCalledWith("/schedule-toolbar/submit-meet");
  });
});
