import { Linking } from "react-native";
import {
  ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
  openExactAlarmSettings,
  remindersNeedExactAlarms,
  shouldOfferExactAlarmSettings,
} from "@/lib/exact-alarms";

describe("exact alarm policy", () => {
  it("needs the permission from Android 12 and offers settings from Android 14", () => {
    expect(remindersNeedExactAlarms("android", 30)).toBe(false);
    expect(remindersNeedExactAlarms("android", 31)).toBe(true);
    expect(shouldOfferExactAlarmSettings("android", 33)).toBe(false);
    expect(shouldOfferExactAlarmSettings("android", 34)).toBe(true);
    expect(shouldOfferExactAlarmSettings("android", 36)).toBe(true);
  });

  it("never applies on iOS, or to an unreadable version", () => {
    expect(remindersNeedExactAlarms("ios", "26.0")).toBe(false);
    expect(shouldOfferExactAlarmSettings("ios", 99)).toBe(false);
    expect(shouldOfferExactAlarmSettings("android", "not a number")).toBe(false);
  });
});

describe("openExactAlarmSettings", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("opens Alarms & reminders", async () => {
    const sendIntent = jest.spyOn(Linking, "sendIntent").mockResolvedValue(undefined);
    await openExactAlarmSettings();
    expect(sendIntent).toHaveBeenCalledWith(ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
  });

  it("falls back to the App info page when that cannot be opened", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(Linking, "sendIntent").mockRejectedValue(new Error("no activity"));
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    await openExactAlarmSettings();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });
});
