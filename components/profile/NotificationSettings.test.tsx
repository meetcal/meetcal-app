/**
 * Session reminders switch on the profile screen. The auto-enable default must
 * never override a choice the user already made, and "unknown" subscription
 * status must fail closed (no auto-enable, no OS permission prompt).
 */
import React from "react";
import { Alert, Switch } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import type { SubscriptionStatus } from "@/app/schedule-toolbar/profile";
import { NOTIFICATION_ENABLED_KEY } from "@/utils/notifications";
import { NotificationSettings } from "@/components/profile/NotificationSettings";

jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("@/components/ui/Toast", () => ({ showToast: jest.fn() }));
jest.mock("expo-notifications", () => ({
  AndroidImportance: { MAX: 5 },
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => undefined),
}));

const mockGetPermissions = Notifications.getPermissionsAsync as jest.Mock;
const mockRequestPermissions = Notifications.requestPermissionsAsync as jest.Mock;
const mockCancelAll = Notifications.cancelAllScheduledNotificationsAsync as jest.Mock;

const requireAuth = jest.fn(() => true);
const router = { push: jest.fn() } as never;

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

async function mount(status: SubscriptionStatus): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <NotificationSettings
        subscriptionStatus={status}
        requireAuth={requireAuth}
        router={router}
      />,
    );
  });
  await flush();
  return renderer;
}

function theSwitch(renderer: ReactTestRenderer) {
  return renderer.root.findByType(Switch);
}

describe("NotificationSettings", () => {
  let setItemSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    // Treat the first-run prompt as already shown so a toggle goes straight
    // to the permission check.
    await AsyncStorage.setItem("hasCheckedNotifications", "true");
    setItemSpy = jest.spyOn(AsyncStorage, "setItem");
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    mockGetPermissions.mockResolvedValue({ status: "granted" });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function reminderWrites(): unknown[] {
    return setItemSpy.mock.calls
      .filter(([key]) => key === NOTIFICATION_ENABLED_KEY)
      .map(([, value]) => value);
  }

  it("auto-enables once for a subscriber who has never chosen", async () => {
    const renderer = await mount("quarterly");

    expect(reminderWrites()).toEqual(["true"]);
    expect(theSwitch(renderer).props.value).toBe(true);
  });

  it("keeps reminders off after the user turns them off on the same visit", async () => {
    await AsyncStorage.setItem(NOTIFICATION_ENABLED_KEY, "true");
    setItemSpy.mockClear();
    const renderer = await mount("lifetime");
    expect(theSwitch(renderer).props.value).toBe(true);

    await act(async () => {
      theSwitch(renderer).props.onValueChange();
    });
    await flush();

    expect(mockCancelAll).toHaveBeenCalledTimes(1);
    expect(reminderWrites()).toEqual(["false"]);
    await expect(AsyncStorage.getItem(NOTIFICATION_ENABLED_KEY)).resolves.toBe("false");
    expect(theSwitch(renderer).props.value).toBe(false);
  });

  it("does not re-enable reminders the user turned off on an earlier visit", async () => {
    await AsyncStorage.setItem(NOTIFICATION_ENABLED_KEY, "false");
    setItemSpy.mockClear();

    const renderer = await mount("quarterly");

    expect(reminderWrites()).toEqual([]);
    expect(mockGetPermissions).not.toHaveBeenCalled();
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(theSwitch(renderer).props.value).toBe(false);
  });

  it("fails closed on an unknown subscription: disabled switch, no prompt, no write", async () => {
    await AsyncStorage.removeItem("hasCheckedNotifications");
    setItemSpy.mockClear();

    const renderer = await mount("unknown");

    expect(theSwitch(renderer).props.disabled).toBe(true);
    expect(theSwitch(renderer).props.value).toBe(false);
    expect(mockGetPermissions).not.toHaveBeenCalled();
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
  });
  describe("when the OS permission is denied", () => {
    function permissionAlerts(): unknown[] {
      return (Alert.alert as jest.Mock).mock.calls.filter(
        ([title]) => title === "Permission Required",
      );
    }

    it("records a denied first-run prompt as off so later visits do not re-prompt", async () => {
      await AsyncStorage.removeItem("hasCheckedNotifications");
      mockGetPermissions.mockResolvedValue({ status: "denied" });
      mockRequestPermissions.mockResolvedValue({ status: "denied" });

      const first = await mount("quarterly");
      await act(async () => first.unmount());
      const second = await mount("quarterly");

      expect(permissionAlerts()).toHaveLength(0);
      expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
      await expect(AsyncStorage.getItem(NOTIFICATION_ENABLED_KEY)).resolves.toBe("false");
      expect(theSwitch(second).props.value).toBe(false);
    });

    it("does not alert on an auto-enable after the prompt was already shown", async () => {
      mockGetPermissions.mockResolvedValue({ status: "denied" });

      const first = await mount("lifetime");
      await act(async () => first.unmount());
      await mount("lifetime");

      expect(permissionAlerts()).toHaveLength(0);
      expect(mockGetPermissions).toHaveBeenCalledTimes(1);
      expect(mockRequestPermissions).not.toHaveBeenCalled();
      expect(reminderWrites()).toEqual(["false"]);
    });

    it("still explains the denied permission when the user taps the switch", async () => {
      await AsyncStorage.setItem(NOTIFICATION_ENABLED_KEY, "false");
      mockGetPermissions.mockResolvedValue({ status: "denied" });
      setItemSpy.mockClear();
      const renderer = await mount("quarterly");

      await act(async () => {
        theSwitch(renderer).props.onValueChange(true);
      });
      await flush();

      expect(permissionAlerts()).toHaveLength(1);
      expect(reminderWrites()).toEqual([]);
      expect(theSwitch(renderer).props.value).toBe(false);
    });
  });
});
