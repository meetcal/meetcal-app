import { Alert, Linking, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import {
  exactAlarmsFromStatus,
  offerExactAlarmSettingsIfDenied,
  openExactAlarmSettings,
  readExactAlarmStatus,
  remindersNeedExactAlarms,
} from "@/lib/exact-alarms";

jest.mock("expo-notifications", () => ({
  __esModule: true,
  getExactAlarmPermissionsAsync: jest.fn(),
  requestExactAlarmPermissionsAsync: jest.fn(),
}));

// The functions are optional at runtime: a binary built before
// expo-notifications 58.1 has neither.
const notifications = Notifications as unknown as {
  getExactAlarmPermissionsAsync?: jest.Mock;
  requestExactAlarmPermissionsAsync?: jest.Mock;
};
const realGet = notifications.getExactAlarmPermissionsAsync;
const realRequest = notifications.requestExactAlarmPermissionsAsync;

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function onAndroid(level: number): void {
  jest.replaceProperty(Platform, "OS", "android");
  jest.spyOn(Platform, "Version", "get").mockReturnValue(level);
}

beforeEach(() => {
  jest.clearAllMocks();
  notifications.getExactAlarmPermissionsAsync = realGet;
  notifications.requestExactAlarmPermissionsAsync = realRequest;
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("remindersNeedExactAlarms", () => {
  it("applies from Android 12 only", () => {
    expect(remindersNeedExactAlarms("android", 30)).toBe(false);
    expect(remindersNeedExactAlarms("android", 31)).toBe(true);
    expect(remindersNeedExactAlarms("android", 36)).toBe(true);
  });

  it("never applies on iOS, or to an unreadable version", () => {
    expect(remindersNeedExactAlarms("ios", "26.0")).toBe(false);
    expect(remindersNeedExactAlarms("android", "not a number")).toBe(false);
  });
});

describe("readExactAlarmStatus", () => {
  it("is not needed on iOS or before Android 12, without asking Android", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    await expect(readExactAlarmStatus()).resolves.toBe("not-needed");
    onAndroid(30);
    await expect(readExactAlarmStatus()).resolves.toBe("not-needed");
    expect(realGet).not.toHaveBeenCalled();
  });

  it("reports what Android answers on Android 12+", async () => {
    onAndroid(34);
    realGet?.mockResolvedValueOnce({ granted: false, status: "denied" });
    await expect(readExactAlarmStatus()).resolves.toBe("denied");
    realGet?.mockResolvedValueOnce({ granted: true, status: "granted" });
    await expect(readExactAlarmStatus()).resolves.toBe("granted");
  });

  it("is unknown, never denied, when the native function is missing", async () => {
    onAndroid(34);
    delete notifications.getExactAlarmPermissionsAsync;
    await expect(readExactAlarmStatus()).resolves.toBe("unknown");
  });

  it("is unknown when the read rejects or answers something malformed", async () => {
    onAndroid(34);
    realGet?.mockRejectedValueOnce(new Error("UnavailabilityError"));
    await expect(readExactAlarmStatus()).resolves.toBe("unknown");
    realGet?.mockResolvedValueOnce(null);
    await expect(readExactAlarmStatus()).resolves.toBe("unknown");
    realGet?.mockResolvedValueOnce({ status: "granted" });
    await expect(readExactAlarmStatus()).resolves.toBe("unknown");
    realGet?.mockResolvedValueOnce({ granted: "yes" });
    await expect(readExactAlarmStatus()).resolves.toBe("unknown");
  });
});

describe("exactAlarmsFromStatus", () => {
  it("tracks exactness only where Android answered", () => {
    expect(exactAlarmsFromStatus("granted")).toBe(true);
    expect(exactAlarmsFromStatus("denied")).toBe(false);
    expect(exactAlarmsFromStatus("unknown")).toBeNull();
    expect(exactAlarmsFromStatus("not-needed")).toBeNull();
  });
});

describe("openExactAlarmSettings", () => {
  it("opens Alarms & reminders for MeetCal", async () => {
    realRequest?.mockResolvedValueOnce({ granted: true });
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    openExactAlarmSettings();
    await flush();
    expect(realRequest).toHaveBeenCalledTimes(1);
    expect(openSettings).not.toHaveBeenCalled();
  });

  it("does not wait for the user to come back", () => {
    realRequest?.mockReturnValueOnce(new Promise(() => {}));
    expect(openExactAlarmSettings()).toBeUndefined();
  });

  it("falls back to App info when the page cannot be opened", async () => {
    realRequest?.mockRejectedValueOnce(new Error("ActivityNotFoundException"));
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    openExactAlarmSettings();
    await flush();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it("falls back to App info when the native function is missing", async () => {
    realRequest?.mockRejectedValueOnce(new Error("UnavailabilityError"));
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    expect(() => openExactAlarmSettings()).not.toThrow();
    await flush();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });
});

describe("offerExactAlarmSettingsIfDenied", () => {
  function offers(): unknown[][] {
    return (Alert.alert as jest.Mock).mock.calls.filter(([title]) => title === "Get reminders on time");
  }

  beforeEach(() => {
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
    onAndroid(34);
  });

  it("offers the settings page when Android denies exact alarms, every time", async () => {
    realGet?.mockResolvedValue({ granted: false });
    await offerExactAlarmSettingsIfDenied();
    await offerExactAlarmSettingsIfDenied();
    expect(offers()).toHaveLength(2);
  });

  it("opens the page from the offer's button", async () => {
    realGet?.mockResolvedValue({ granted: false });
    realRequest?.mockResolvedValue({ granted: true });
    await offerExactAlarmSettingsIfDenied();
    const buttons = offers()[0][2] as { text: string; onPress?: () => void }[];
    buttons.find((button) => button.text === "Open Settings")?.onPress?.();
    expect(realRequest).toHaveBeenCalledTimes(1);
  });

  it("offers nothing when granted, unreadable, or not needed", async () => {
    realGet?.mockResolvedValue({ granted: true });
    await offerExactAlarmSettingsIfDenied();
    delete notifications.getExactAlarmPermissionsAsync;
    await offerExactAlarmSettingsIfDenied();
    jest.replaceProperty(Platform, "OS", "ios");
    await offerExactAlarmSettingsIfDenied();
    expect(offers()).toHaveLength(0);
  });
});
