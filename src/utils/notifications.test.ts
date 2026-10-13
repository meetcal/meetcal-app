import { Platform } from "react-native";
import { getNotificationDeepLink, normalizeDeepLinkHref } from "@/utils/deepLinks";
const mockScheduleNotificationAsync = jest.fn(async (_request: unknown) => "notif-1");
const mockCancelScheduledNotificationAsync = jest.fn(async (_id: string) => {});
const mockSetNotificationHandler = jest.fn();
const mockSetNotificationChannelAsync = jest.fn(async (_id: string, _channel: unknown) => null);

jest.mock("expo-notifications", () => ({
  AndroidNotificationPriority: { HIGH: "high" },
  AndroidImportance: { MAX: 5 },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: "timeInterval", DATE: "date" },
  setNotificationHandler: (handler: unknown) => mockSetNotificationHandler(handler),
  setNotificationChannelAsync: (id: string, channel: unknown) =>
    mockSetNotificationChannelAsync(id, channel),
  scheduleNotificationAsync: (request: unknown) => mockScheduleNotificationAsync(request),
  cancelScheduledNotificationAsync: (id: string) => mockCancelScheduledNotificationAsync(id),
}));


// Required, not imported: the module registers its handler at load, and an
// import would be hoisted above the mock functions it calls.
const {
  ANDROID_NOTIFICATION_CHANNEL_ID,
  cancelNotification,
  ensureReminderChannel,
  resetReminderChannelForTests,
  scheduleNotification,
} = require("@/utils/notifications") as typeof import("@/utils/notifications");

const NOW = Date.UTC(2026, 5, 20, 15, 0, 0);

type ScheduledRequest = {
  content: { title: string; body: string; data: Record<string, unknown> };
  trigger: { type: string; date: number; channelId?: string };
  identifier?: string;
};

function lastRequest(): ScheduledRequest {
  return mockScheduleNotificationAsync.mock.calls.at(-1)![0] as ScheduledRequest;
}

beforeEach(() => {
  mockScheduleNotificationAsync.mockClear();
  mockCancelScheduledNotificationAsync.mockReset();
  jest.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("notification handler", () => {
  it("is registered at import to show saved-session reminders in the foreground", async () => {
    expect(mockSetNotificationHandler).toHaveBeenCalledTimes(1);
    const { handleNotification } = mockSetNotificationHandler.mock.calls[0][0] as {
      handleNotification: () => Promise<Record<string, boolean>>;
    };
    await expect(handleNotification()).resolves.toMatchObject({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
    });
  });
});

describe("scheduleNotification", () => {
  it("schedules a wall-clock trigger at the instant", async () => {
    const trigger = new Date(NOW + 90_999);
    await expect(
      scheduleNotification("Session soon", "Session 4 starts in 30 min", trigger, "sess-4"),
    ).resolves.toBe("notif-1");

    const request = lastRequest();
    expect(request.trigger).toEqual({
      type: "date",
      date: NOW + 90_999,
      channelId: "default",
    });
    expect(request.identifier).toBe("sess-4");
    expect(request.content).toMatchObject({ title: "Session soon", body: "Session 4 starts in 30 min" });
    expect(request.content.data).toEqual({ identifier: "sess-4", url: undefined });
  });

  it("delivers on the Android channel the settings screens create", async () => {
    // expo-notifications routes a channel-less trigger to its fallback
    // "Miscellaneous" channel, so the MAX-importance "default" channel the
    // app registers (vibration, light, heads-up) would never carry a reminder.
    await scheduleNotification("t", "b", new Date(NOW + 60_000), "sess-4");
    expect(ANDROID_NOTIFICATION_CHANNEL_ID).toBe("default");
    expect(lastRequest().trigger.channelId).toBe(ANDROID_NOTIFICATION_CHANNEL_ID);
  });

  it.each([
    ["in the past", NOW - 60_000],
    ["now", NOW],
    ["that is not a date", Number.NaN],
  ])("does not schedule a trigger %s", async (_label, at) => {
    await expect(scheduleNotification("t", "b", new Date(at), "id")).resolves.toBeUndefined();
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("carries a session deep link that opens schedule details with its params", async () => {
    await scheduleNotification("t", "b", new Date(NOW + 60_000), "sess-4", {
      meet: "2026 USAW Nationals",
      sessionNumber: 4,
      platform: "Red",
      weightClass: "89kg",
      startTime: "2026-06-20T10:00:00",
      date: "2026-06-20",
    });

    // What a tap on the notification hands the router.
    const link = getNotificationDeepLink(lastRequest().content.data);
    expect(link).not.toBeNull();
    const href = normalizeDeepLinkHref(link!);
    expect(typeof href).toBe("string");
    const [path, query] = (href as string).split("?");
    expect(path).toBe("/shared-screens/schedule-details");
    expect(Object.fromEntries(new URLSearchParams(query))).toEqual({
      meet: "2026 USAW Nationals",
      sessionNumber: "4",
      platform: "Red",
      weightClass: "89kg",
      startTime: "2026-06-20T10:00:00",
      date: "2026-06-20",
    });
  });

  it("propagates a scheduling failure", async () => {
    mockScheduleNotificationAsync.mockRejectedValueOnce(new Error("permission denied"));
    await expect(scheduleNotification("t", "b", new Date(NOW + 60_000))).rejects.toThrow(
      "permission denied",
    );
  });
});

describe("ensureReminderChannel", () => {
  beforeEach(() => {
    resetReminderChannelForTests();
    mockSetNotificationChannelAsync.mockReset();
    mockSetNotificationChannelAsync.mockResolvedValue(null);
  });

  it("creates the named, high-importance reminders channel once on Android", async () => {
    jest.replaceProperty(Platform, "OS", "android");

    await ensureReminderChannel();
    await ensureReminderChannel();
    await scheduleNotification("t", "b", new Date(NOW + 60_000), "sess-4");

    expect(mockSetNotificationChannelAsync).toHaveBeenCalledTimes(1);
    expect(mockSetNotificationChannelAsync).toHaveBeenCalledWith(ANDROID_NOTIFICATION_CHANNEL_ID, {
      name: "Session reminders",
      importance: 5,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    });
  });

  it("creates the channel before scheduling, however reminders were reached", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    const order: string[] = [];
    mockSetNotificationChannelAsync.mockImplementation(async () => {
      order.push("channel");
      return null;
    });
    mockScheduleNotificationAsync.mockImplementationOnce(async () => {
      order.push("schedule");
      return "notif-1";
    });

    await scheduleNotification("t", "b", new Date(NOW + 60_000), "sess-4");

    expect(order).toEqual(["channel", "schedule"]);
  });

  it("logs a failure, still schedules, and tries again next time", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockSetNotificationChannelAsync.mockRejectedValueOnce(new Error("binder"));

    await expect(scheduleNotification("t", "b", new Date(NOW + 60_000))).resolves.toBe("notif-1");
    await ensureReminderChannel();

    expect(mockSetNotificationChannelAsync).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("does nothing on iOS", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    await ensureReminderChannel();
    expect(mockSetNotificationChannelAsync).not.toHaveBeenCalled();
  });
});

describe("cancelNotification", () => {
  it("cancels by identifier", async () => {
    await cancelNotification("sess-4");
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith("sess-4");
  });

  it("wraps a failure with the original as its cause", async () => {
    const original = new Error("no such notification");
    mockCancelScheduledNotificationAsync.mockRejectedValueOnce(original);
    const failure: unknown = await cancelNotification("sess-4").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("cancelNotification failed: no such notification");
    expect((failure as Error).cause).toBe(original);
  });

  it("wraps a non-Error rejection too", async () => {
    mockCancelScheduledNotificationAsync.mockRejectedValueOnce("boom");
    const failure = (await cancelNotification("x").catch((e: unknown) => e)) as Error;
    expect(failure.message).toBe("cancelNotification failed: boom");
    expect(failure.cause).toBeInstanceOf(Error);
  });
});
