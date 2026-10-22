/**
 * Session reminders switch on the profile screen. The auto-enable default must
 * never override a choice the user already made, and "unknown" subscription
 * status must fail closed (no auto-enable, no OS permission prompt).
 */
import React from "react";
import { Alert, AppState, Platform, Switch } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import type { SubscriptionStatus } from "@/app/schedule-toolbar/profile";
import { NOTIFICATION_ENABLED_KEY } from "@/utils/notifications";
import { subscribeToReminderPreference } from "@/lib/reminder-preference";
import { NotificationSettings } from "@/components/profile/NotificationSettings";
import { showToast } from "@/components/ui/Toast";

jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("@/components/ui/Toast", () => ({ showToast: jest.fn() }));
jest.mock("expo-notifications", () => ({
  AndroidImportance: { MAX: 5 },
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getExactAlarmPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestExactAlarmPermissionsAsync: jest.fn(async () => ({ granted: true })),
}));

const mockGetPermissions = Notifications.getPermissionsAsync as jest.Mock;
const mockRequestPermissions = Notifications.requestPermissionsAsync as jest.Mock;
const mockGetExactAlarms = Notifications.getExactAlarmPermissionsAsync as jest.Mock;
const mockRequestExactAlarms = Notifications.requestExactAlarmPermissionsAsync as jest.Mock;

const requireAuth = jest.fn(() => true);
const router = { push: jest.fn() };

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
        router={router as never}
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
    mockGetExactAlarms.mockResolvedValue({ granted: true });
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
    // The reminder sync listens for the change and cancels the reminders.
    const onPreferenceChange = jest.fn();
    const unsubscribe = subscribeToReminderPreference(onPreferenceChange);

    await act(async () => {
      theSwitch(renderer).props.onValueChange();
    });
    await flush();
    unsubscribe();

    expect(onPreferenceChange).toHaveBeenCalledTimes(1);
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
  it("tells a tap on an unknown subscription it can't confirm it, without the upgrade prompt", async () => {
    const renderer = await mount("unknown");
    const row = renderer.root.findAll(
      (node) => typeof node.props.onPress === "function" && node.props.disabled === false,
    )[0];

    await act(async () => {
      row.props.onPress();
    });
    await flush();

    expect((Alert.alert as jest.Mock).mock.calls.map(([title]) => title)).not.toContain(
      "Premium Feature",
    );
    expect(router.push).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/confirm your subscription/) }),
    );
  });

  it("keeps showing the default-on policy, with no toast, when the first-run write fails", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const realSetItem = setItemSpy.getMockImplementation();
    let failed = false;
    setItemSpy.mockImplementation(async (key: string, value: string) => {
      if (key === NOTIFICATION_ENABLED_KEY && !failed) {
        failed = true;
        throw new Error("storage full");
      }
      return realSetItem ? realSetItem(key, value) : undefined;
    });

    const renderer = await mount("quarterly");

    expect(failed).toBe(true);
    // Never written, so the reminder policy is still "on" for a subscriber.
    expect(theSwitch(renderer).props.value).toBe(true);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("auto-enables while the sign-in check is still resolving, without a toast", async () => {
    // `useAuthGuard` answers null until its cache and network reads land,
    // which can be after this screen's own storage read.
    requireAuth.mockReturnValue(null as never);
    try {
      const renderer = await mount("quarterly");

      expect(reminderWrites()).toEqual(["true"]);
      expect(theSwitch(renderer).props.value).toBe(true);
      expect(showToast).not.toHaveBeenCalled();
    } finally {
      requireAuth.mockReturnValue(true);
    }
  });

  it("shows reminders on for a subscriber who never chose, and a tap meanwhile cannot be overwritten", async () => {
    // The auto-enable is still waiting on the OS.
    let answer!: (value: { status: string }) => void;
    mockGetPermissions.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const renderer = await mount("quarterly");

    expect(reminderWrites()).toEqual([]);
    // The sync schedules reminders for this user, so the switch says so.
    expect(theSwitch(renderer).props.value).toBe(true);
    expect(theSwitch(renderer).props.disabled).toBe(true);

    // A tap while it runs is dropped, not raced against it.
    await act(async () => {
      theSwitch(renderer).props.onValueChange(false);
    });
    await act(async () => {
      answer({ status: "granted" });
    });
    await flush();

    expect(reminderWrites()).toEqual(["true"]);
    expect(theSwitch(renderer).props.disabled).toBe(false);

    // Then one tap turns them off.
    await act(async () => {
      theSwitch(renderer).props.onValueChange(false);
    });
    await flush();

    expect(reminderWrites()).toEqual(["true", "false"]);
    expect(theSwitch(renderer).props.value).toBe(false);
  });

  describe("on Android 14", () => {
    let foreground: ((state: string) => void) | undefined;

    beforeEach(() => {
      jest.replaceProperty(Platform, "OS", "android");
      jest.spyOn(Platform, "Version", "get").mockReturnValue(34);
      foreground = undefined;
      jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
        foreground = listener as (state: string) => void;
        return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
      });
    });

    function exactAlarmAlerts(): unknown[][] {
      return (Alert.alert as jest.Mock).mock.calls.filter(
        ([title]) => title === "Get reminders on time",
      );
    }

    function text(renderer: ReactTestRenderer): string {
      return JSON.stringify(renderer.toJSON());
    }

    async function tap(renderer: ReactTestRenderer): Promise<void> {
      await act(async () => {
        theSwitch(renderer).props.onValueChange();
      });
      await flush();
    }

    it("offers the exact-alarm settings each time the user turns reminders on while denied", async () => {
      mockGetExactAlarms.mockResolvedValue({ granted: false });
      await AsyncStorage.setItem(NOTIFICATION_ENABLED_KEY, "false");
      setItemSpy.mockClear();
      const renderer = await mount("quarterly");

      for (let i = 0; i < 3; i += 1) await tap(renderer);

      expect(reminderWrites()).toEqual(["true", "false", "true"]);
      expect(exactAlarmAlerts()).toHaveLength(2);

      const buttons = exactAlarmAlerts()[0][2] as { text: string; onPress?: () => void }[];
      buttons.find((button) => button.text === "Open Settings")?.onPress?.();
      expect(mockRequestExactAlarms).toHaveBeenCalledTimes(1);
    });

    it("offers nothing when exact alarms are allowed", async () => {
      mockGetExactAlarms.mockResolvedValue({ granted: true });
      await AsyncStorage.setItem(NOTIFICATION_ENABLED_KEY, "false");
      setItemSpy.mockClear();
      const renderer = await mount("quarterly");

      await tap(renderer);

      expect(reminderWrites()).toEqual(["true"]);
      expect(exactAlarmAlerts()).toHaveLength(0);
      expect(text(renderer)).not.toContain("Alarms & reminders");
    });

    it("says reminders may arrive late only while denied, and pops nothing for the first-run default", async () => {
      mockGetExactAlarms.mockResolvedValue({ granted: false });
      const renderer = await mount("quarterly");

      expect(reminderWrites()).toEqual(["true"]);
      expect(exactAlarmAlerts()).toHaveLength(0);
      expect(text(renderer)).toContain("Alarms & reminders is off for MeetCal");
    });

    it("drops the note when the user comes back from settings with it allowed", async () => {
      mockGetExactAlarms.mockResolvedValue({ granted: false });
      const renderer = await mount("quarterly");
      expect(text(renderer)).toContain("may arrive late");

      mockGetExactAlarms.mockResolvedValue({ granted: true });
      await act(async () => {
        foreground?.("active");
      });
      await flush();

      expect(text(renderer)).not.toContain("may arrive late");
    });

    it("hedges, and offers nothing, when the permission cannot be read", async () => {
      jest.spyOn(console, "warn").mockImplementation(() => {});
      mockGetExactAlarms.mockRejectedValue(new Error("UnavailabilityError"));
      await AsyncStorage.setItem(NOTIFICATION_ENABLED_KEY, "false");
      const renderer = await mount("quarterly");

      await tap(renderer);

      expect(exactAlarmAlerts()).toHaveLength(0);
      expect(text(renderer)).toContain("If Alarms & reminders is off");
    });
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
