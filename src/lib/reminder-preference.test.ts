import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  readReminderPreference,
  resolveRemindersPolicy,
  setRemindersEnabled,
  subscribeToReminderPreference,
} from "@/lib/reminder-preference";
import { NOTIFICATION_ENABLED_KEY } from "@/utils/notifications";

jest.mock("@/utils/notifications", () => ({
  NOTIFICATION_ENABLED_KEY: "notificationsEnabled",
}));

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("resolveRemindersPolicy", () => {
  it.each([
    [true, true, "on"],
    [null, true, "on"],
    [true, false, "off"],
    [null, false, "off"],
    [false, true, "off"],
    [false, null, "off"],
    [true, null, "unknown"],
    [null, null, "unknown"],
  ] as const)("preference %p, subscribed %p: %s", (preference, isSubscribed, policy) => {
    expect(resolveRemindersPolicy(preference, isSubscribed)).toBe(policy);
  });
});

describe("the stored preference", () => {
  it("is null until the user chooses", async () => {
    await expect(readReminderPreference()).resolves.toBeNull();
    await AsyncStorage.setItem(NOTIFICATION_ENABLED_KEY, "garbage");
    await expect(readReminderPreference()).resolves.toBeNull();
  });

  it("stores the choice and tells subscribers", async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToReminderPreference(listener);

    await setRemindersEnabled(true);
    await expect(readReminderPreference()).resolves.toBe(true);
    unsubscribe();
    await setRemindersEnabled(false);

    await expect(readReminderPreference()).resolves.toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
