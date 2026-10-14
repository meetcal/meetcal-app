import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createReminderSyncRunner,
  defaultReminderSyncDeps,
  REMINDER_CLOCK_SAMPLE_MAX_AGE_MS,
  reminderClockSkewMs,
  MAX_PENDING_REMINDERS,
  type DesiredReminder,
  NOTIFICATION_LEAD_MS,
  planReminderSync,
  reminderTriggerDate,
  type ReminderSyncDeps,
  resolveDesiredReminders,
  SESSION_REMINDER_KIND,
  syncSessionReminders,
  toScheduledReminders,
} from "@/lib/saved-sessions-reminders";
import type { SavedSession } from "@/lib/saved-sessions-store";
import type { Schedule } from "@/types/schedule";
import {
  cancelNotification,
  listScheduledNotifications,
  NOTIFICATION_ENABLED_KEY,
  scheduleNotification,
} from "@/utils/notifications";

jest.mock("@/utils/notifications", () => ({
  NOTIFICATION_ENABLED_KEY: "notificationsEnabled",
  scheduleNotification: jest.fn(async () => "notification-id"),
  cancelNotification: jest.fn(async () => undefined),
  listScheduledNotifications: jest.fn(async () => []),
}));

jest.mock("@/lib/database/offline-store", () => ({
  getMeetSchedule: jest.fn(async () => []),
}));

// Wall clock read as UTC: "11:00 AM" on 2099-06-20 is 2099-06-20T11:00Z.
jest.mock("@/data/meets/config", () => ({
  getMeetConfig: jest.fn(),
  convertToUTC: jest.fn((time: string, date: string) => {
    const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(time);
    if (!match) throw new Error(`bad time ${time}`);
    const hour = (Number(match[1]) % 12) + (match[3] === "PM" ? 12 : 0);
    return new Date(`${date}T${String(hour).padStart(2, "0")}:${match[2]}:00.000Z`);
  }),
}));

const mockScheduleNotification = scheduleNotification as jest.MockedFunction<
  typeof scheduleNotification
>;
const mockCancelNotification = cancelNotification as jest.MockedFunction<
  typeof cancelNotification
>;
const mockListScheduled = listScheduledNotifications as jest.MockedFunction<
  typeof listScheduledNotifications
>;

const NOW = new Date("2099-06-20T08:00:00.000Z");

function saved(id: string, overrides: Partial<SavedSession> = {}): SavedSession {
  return {
    id,
    meet: "Test Meet" as never,
    sessionNumber: 1,
    platform: "Red",
    weightClass: "71kg",
    startTime: "11:00 AM",
    weighInTime: "9:00 AM",
    date: "2099-06-20",
    ...overrides,
  };
}

/** Session 1 on Red, moved to 2:00 PM. */
const MOVED_SCHEDULE = [
  {
    date: "June 20, 2099",
    fullDate: "2099-06-20",
    sessions: [
      {
        id: "s1",
        number: 1,
        startTime: "2:00 PM",
        weighInTime: "12:00 PM",
        platforms: [{ platform: "Red", weightClass: "71kg", platformStartTime: "2:00 PM" }],
      },
    ],
  },
] as unknown as Schedule;

function deps(overrides: Partial<ReminderSyncDeps> = {}): ReminderSyncDeps {
  return {
    now: () => NOW,
    timeZoneFor: jest.fn(async () => "UTC"),
    readSchedule: jest.fn(async () => [] as Schedule),
    ...overrides,
  };
}

function reminder(id: string, triggerAtMs: number, fireAtMs = triggerAtMs): DesiredReminder {
  return { session: saved(id), triggerAtMs, fireAtMs };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockListScheduled.mockResolvedValue([]);
});

describe("reminderTriggerDate", () => {
  it("fires one hour before the session starts", () => {
    const start = new Date("2099-06-20T15:00:00.000Z");
    expect(NOTIFICATION_LEAD_MS).toBe(60 * 60 * 1000);
    expect(reminderTriggerDate(start).toISOString()).toBe("2099-06-20T14:00:00.000Z");
  });
});

describe("toScheduledReminders", () => {
  it("reads tagged reminders and untagged ones from older builds, and nothing else", () => {
    expect(
      toScheduledReminders([
        { identifier: "a", data: { kind: SESSION_REMINDER_KIND, triggerAtMs: 5, identifier: "a" } },
        { identifier: "b", data: { identifier: "b", url: "meetcal://x" } },
        { identifier: "c", data: { kind: "something-else", identifier: "c" } },
        { identifier: "d", data: {} },
      ]),
    ).toEqual([
      { id: "a", triggerAtMs: 5, fireAtMs: null },
      { id: "b", triggerAtMs: null, fireAtMs: null },
    ]);
  });
});

describe("planReminderSync", () => {
  const savedIds = new Set(["kept", "moved", "missing", "past", "offline"]);
  const scheduled = [
    { id: "kept", triggerAtMs: 100 },
    { id: "moved", triggerAtMs: 100 },
    { id: "past", triggerAtMs: 50 },
    { id: "offline", triggerAtMs: 100 },
    { id: "unsaved", triggerAtMs: 100 },
  ];
  const desired = new Map([
    ["kept", reminder("kept", 100)],
    ["moved", reminder("moved", 200)],
    ["missing", reminder("missing", 300)],
  ]);
  const unresolvedIds = new Set(["offline"]);

  it("schedules what is missing or moved and cancels what is no longer wanted", () => {
    const plan = planReminderSync({ policy: "on", scheduled, savedIds, desired, unresolvedIds });
    expect(plan.cancel.sort()).toEqual(["past", "unsaved"]);
    expect(plan.schedule.map((r) => [r.session.id, r.triggerAtMs])).toEqual([
      ["moved", 200],
      ["missing", 300],
    ]);
  });

  it("cancels every reminder when reminders are off", () => {
    const plan = planReminderSync({ policy: "off", scheduled, savedIds, desired, unresolvedIds });
    expect(plan.cancel).toEqual(scheduled.map((r) => r.id));
    expect(plan.schedule).toEqual([]);
  });

  it("only cancels unsaved sessions' reminders while the subscription is unknown", () => {
    const plan = planReminderSync({ policy: "unknown", scheduled, savedIds, desired, unresolvedIds });
    expect(plan.cancel).toEqual(["unsaved"]);
    expect(plan.schedule).toEqual([]);
  });

  it("cancels everything for an empty (signed-out) list", () => {
    const plan = planReminderSync({
      policy: "on",
      scheduled,
      savedIds: new Set(),
      desired: new Map(),
      unresolvedIds: new Set(),
    });
    expect(plan.cancel).toEqual(scheduled.map((r) => r.id));
  });
});

describe("resolveDesiredReminders", () => {
  it("uses the schedule's current start time over the one saved", async () => {
    const { desired } = await resolveDesiredReminders(
      [saved("a")],
      deps({ readSchedule: jest.fn(async () => MOVED_SCHEDULE) }),
    );
    expect(desired.get("a")?.triggerAtMs).toBe(Date.parse("2099-06-20T13:00:00.000Z"));
    expect(desired.get("a")?.session.startTime).toBe("2:00 PM");
  });

  it("falls back to the saved time when the schedule does not have the session", async () => {
    const { desired } = await resolveDesiredReminders([saved("a")], deps());
    expect(desired.get("a")?.triggerAtMs).toBe(Date.parse("2099-06-20T10:00:00.000Z"));
  });

  it("leaves sessions whose meet zone is unknown unresolved", async () => {
    const { desired, unresolvedIds } = await resolveDesiredReminders(
      [saved("a"), saved("b", { startTime: "" })],
      deps({ timeZoneFor: jest.fn(async () => null) }),
    );
    expect(desired.size).toBe(0);
    expect([...unresolvedIds].sort()).toEqual(["a", "b"]);
  });

  it("wants no reminder once its moment has passed", async () => {
    const { desired, unresolvedIds } = await resolveDesiredReminders(
      [saved("a", { startTime: "8:30 AM" })],
      deps(),
    );
    expect(desired.size).toBe(0);
    expect(unresolvedIds.size).toBe(0);
  });

  it("keeps only the soonest reminders under the OS's pending limit", async () => {
    const sessions = Array.from({ length: MAX_PENDING_REMINDERS + 5 }, (_, i) =>
      saved(`s${i}`, { sessionNumber: i + 1, date: `2099-07-${String((i % 28) + 1).padStart(2, "0")}` }),
    );
    const { desired } = await resolveDesiredReminders(sessions, deps());
    expect(desired.size).toBe(MAX_PENDING_REMINDERS);
    const latestKept = Math.max(...[...desired.values()].map((r) => r.triggerAtMs));
    const dropped = sessions.filter((s) => !desired.has(s.id));
    expect(dropped).toHaveLength(5);
    for (const session of dropped) {
      expect(Date.parse(`${session.date}T10:00:00.000Z`)).toBeGreaterThanOrEqual(latestKept);
    }
  });

  it("skips meets whose sessions are all in the past without looking up the zone", async () => {
    const d = deps();
    const { desired } = await resolveDesiredReminders(
      [saved("old", { meet: "Old Meet" as never, date: "2098-01-01" })],
      d,
    );
    expect(desired.size).toBe(0);
    expect(d.timeZoneFor).not.toHaveBeenCalled();
  });

  it("reminds a session whose saved day is past but whose schedule moved it ahead", async () => {
    const { desired } = await resolveDesiredReminders(
      [saved("a", { date: "2099-06-17" })],
      deps({ readSchedule: jest.fn(async () => MOVED_SCHEDULE) }),
    );
    expect(desired.get("a")?.triggerAtMs).toBe(Date.parse("2099-06-20T13:00:00.000Z"));
    expect(desired.get("a")?.session.date).toBe("2099-06-20");
  });
});

describe("syncSessionReminders", () => {
  it("schedules a tagged reminder for a subscriber who never chose", async () => {
    await syncSessionReminders([saved("a")], true, deps());

    expect(mockScheduleNotification).toHaveBeenCalledWith(
      "Session Reminder",
      "Session 1 Red starts in 1 hour.",
      new Date("2099-06-20T10:00:00.000Z"),
      "a",
      expect.objectContaining({ id: "a", startTime: "11:00 AM", date: "2099-06-20" }),
      {
        kind: SESSION_REMINDER_KIND,
        triggerAtMs: Date.parse("2099-06-20T10:00:00.000Z"),
        fireAtMs: Date.parse("2099-06-20T10:00:00.000Z"),
      },
    );
  });

  describe("on the server's clock", () => {
    const HOUR_MS = 60 * 60 * 1000;
    // The device clock reads two hours ahead of the server's.
    const fastDevice = (overrides: Partial<ReminderSyncDeps> = {}) =>
      deps({
        now: () => new Date(NOW.getTime() + 2 * HOUR_MS),
        clockSkewMs: () => -2 * HOUR_MS,
        ...overrides,
      });

    it("fires at the right moment on a device clock two hours fast", async () => {
      await syncSessionReminders([saved("a")], true, fastDevice());

      const triggerAtMs = Date.parse("2099-06-20T10:00:00.000Z");
      // The OS fires by the device clock: 12:00 on it is 10:00 on the server's.
      expect(mockScheduleNotification.mock.calls[0][2]).toEqual(new Date(triggerAtMs + 2 * HOUR_MS));
      expect(mockScheduleNotification.mock.calls[0][5]).toEqual({
        kind: SESSION_REMINDER_KIND,
        triggerAtMs,
        fireAtMs: triggerAtMs + 2 * HOUR_MS,
      });
    });

    it("still reminds a session within the skew of the device's now", async () => {
      // Server 9:00, device 11:00. The 10:30 reminder is still ahead on the
      // server's clock but already past on the device's.
      const { desired } = await resolveDesiredReminders(
        [saved("a", { startTime: "11:30 AM" })],
        deps({ now: () => new Date(Date.parse("2099-06-20T09:00:00.000Z") + 2 * HOUR_MS), clockSkewMs: () => -2 * HOUR_MS }),
      );
      expect(desired.get("a")?.triggerAtMs).toBe(Date.parse("2099-06-20T10:30:00.000Z"));
    });

    it("reschedules a reminder set before the device clock was found wrong", async () => {
      const triggerAtMs = Date.parse("2099-06-20T10:00:00.000Z");
      mockListScheduled.mockResolvedValue([
        { identifier: "a", data: { kind: SESSION_REMINDER_KIND, triggerAtMs } },
      ]);

      await syncSessionReminders([saved("a")], true, fastDevice());

      expect(mockScheduleNotification).toHaveBeenCalledTimes(1);
      expect(mockScheduleNotification.mock.calls[0][2]).toEqual(new Date(triggerAtMs + 2 * HOUR_MS));
    });

    describe("before the first clock sample (a cold start offline)", () => {
      const triggerAtMs = Date.parse("2099-06-20T10:00:00.000Z");
      // Scheduled by an earlier run that had a sample: the device is two
      // hours fast, so it fires at 12:00 on the device's clock.
      const corrected = {
        identifier: "a",
        data: { kind: SESSION_REMINDER_KIND, triggerAtMs, fireAtMs: triggerAtMs + 2 * HOUR_MS },
      };
      const noSample = (deviceNowMs: number) =>
        deps({ now: () => new Date(deviceNowMs), clockSkewMs: () => null });

      it("keeps a corrected reminder rather than moving it to the device's clock", async () => {
        mockListScheduled.mockResolvedValue([corrected]);

        await syncSessionReminders([saved("a")], true, noSample(NOW.getTime() + 2 * HOUR_MS));

        expect(mockScheduleNotification).not.toHaveBeenCalled();
        expect(mockCancelNotification).not.toHaveBeenCalled();
      });

      it("keeps a reminder that looks past only by the device's clock", async () => {
        mockListScheduled.mockResolvedValue([corrected]);

        // 11:00 on the device, 9:00 on the server: the 10:00 reminder is ahead.
        await syncSessionReminders([saved("a")], true, noSample(triggerAtMs + HOUR_MS));

        expect(mockCancelNotification).not.toHaveBeenCalled();
        expect(mockScheduleNotification).not.toHaveBeenCalled();
      });

      it("schedules a missing reminder on the device's clock and marks it for correction", async () => {
        await syncSessionReminders([saved("a")], true, noSample(NOW.getTime()));

        expect(mockScheduleNotification.mock.calls[0][2]).toEqual(new Date(triggerAtMs));
        expect(mockScheduleNotification.mock.calls[0][5]).toEqual({
          kind: SESSION_REMINDER_KIND,
          triggerAtMs,
          fireAtMs: triggerAtMs,
        });
      });

      it("keeps a reminder whose meet looks days past only by the device's clock", async () => {
        mockListScheduled.mockResolvedValue([corrected]);

        // The device reads June 22 08:00; the server June 20 08:00. The
        // meet's date is before the device's past-date cutoff.
        await syncSessionReminders([saved("a")], true, noSample(NOW.getTime() + 2 * 24 * HOUR_MS));

        expect(mockCancelNotification).not.toHaveBeenCalled();
        expect(mockScheduleNotification).not.toHaveBeenCalled();
      });

      it("still moves a reminder whose session moved", async () => {
        mockListScheduled.mockResolvedValue([corrected]);

        await syncSessionReminders(
          [saved("a")],
          true,
          deps({ now: () => NOW, clockSkewMs: () => null, readSchedule: jest.fn(async () => MOVED_SCHEDULE) }),
        );

        expect(mockScheduleNotification).toHaveBeenCalledTimes(1);
        expect(mockScheduleNotification.mock.calls[0][2]).toEqual(
          new Date("2099-06-20T13:00:00.000Z"),
        );
      });
    });

    it("leaves a reminder alone when the skew only jitters", async () => {
      const triggerAtMs = Date.parse("2099-06-20T10:00:00.000Z");
      mockListScheduled.mockResolvedValue([
        {
          identifier: "a",
          data: { kind: SESSION_REMINDER_KIND, triggerAtMs, fireAtMs: triggerAtMs + 2 * HOUR_MS + 40 },
        },
      ]);

      await syncSessionReminders([saved("a")], true, fastDevice());

      expect(mockScheduleNotification).not.toHaveBeenCalled();
    });
  });

  it("schedules nothing for a meet with no known zone (the default dependency)", async () => {
    // `getMeetConfig` hands back the mapper's New York fallback, flagged.
    const { getMeetConfig } = jest.requireMock("@/data/meets/config") as {
      getMeetConfig: jest.Mock;
    };
    getMeetConfig.mockResolvedValue({
      time: { timeZone: "", timeZoneIdentifier: "America/New_York" },
      timeZoneUnknown: true,
    });

    await syncSessionReminders([saved("a")], true, {
      ...deps(),
      timeZoneFor: defaultReminderSyncDeps.timeZoneFor,
    });

    expect(mockScheduleNotification).not.toHaveBeenCalled();
  });

  it("gives a free user no reminders, and cancels any left over, even with the flag on", async () => {
    await AsyncStorage.setItem(NOTIFICATION_ENABLED_KEY, "true");
    mockListScheduled.mockResolvedValue([{ identifier: "a", data: { identifier: "a" } }]);

    await syncSessionReminders([saved("a")], false, deps());

    expect(mockScheduleNotification).not.toHaveBeenCalled();
    expect(mockCancelNotification).toHaveBeenCalledWith("a");
  });

  it("cancels every reminder when the user turned them off", async () => {
    await AsyncStorage.setItem(NOTIFICATION_ENABLED_KEY, "false");
    mockListScheduled.mockResolvedValue([
      { identifier: "a", data: { kind: SESSION_REMINDER_KIND, triggerAtMs: 1 } },
    ]);

    await syncSessionReminders([saved("a")], true, deps());

    expect(mockCancelNotification).toHaveBeenCalledWith("a");
    expect(mockScheduleNotification).not.toHaveBeenCalled();
  });

  it("does not touch a reminder that is already right", async () => {
    mockListScheduled.mockResolvedValue([
      {
        identifier: "a",
        data: { kind: SESSION_REMINDER_KIND, triggerAtMs: Date.parse("2099-06-20T10:00:00.000Z") },
      },
    ]);

    await syncSessionReminders([saved("a")], true, deps());

    expect(mockScheduleNotification).not.toHaveBeenCalled();
    expect(mockCancelNotification).not.toHaveBeenCalled();
  });

  it("logs rather than throws when the OS refuses", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockScheduleNotification.mockRejectedValueOnce(new Error("denied"));
    mockListScheduled.mockResolvedValueOnce([{ identifier: "gone", data: { identifier: "gone" } }]);
    mockCancelNotification.mockRejectedValueOnce(new Error("busy"));

    await expect(syncSessionReminders([saved("a")], true, deps())).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});

describe("createReminderSyncRunner", () => {
  it("runs one sync at a time and only the latest of those queued meanwhile", async () => {
    const runner = createReminderSyncRunner();
    const ran: string[] = [];
    let release: () => void = () => {};
    const first = runner.run(
      () =>
        new Promise<void>((resolve) => {
          ran.push("first");
          release = resolve;
        }),
    );
    void runner.run(async () => {
      ran.push("stale");
    });
    const last = runner.run(async () => {
      ran.push("latest");
    });

    release();
    await first;
    await last;
    expect(ran).toEqual(["first", "latest"]);
  });
});

describe("reminderClockSkewMs", () => {
  const T = 1_000_000_000;
  it("is null before any sample and the sample's skew after, however large", () => {
    expect(reminderClockSkewMs(null, T)).toBeNull();
    expect(reminderClockSkewMs({ skewMs: 1500, sampledAt: T - 1 }, T)).toBe(1500);
    expect(reminderClockSkewMs({ skewMs: -2 * 60 * 60 * 1000, sampledAt: T }, T)).toBe(-2 * 60 * 60 * 1000);
    expect(reminderClockSkewMs({ skewMs: Number.NaN, sampledAt: T }, T)).toBeNull();
  });

  it("is unknown for a sample too old, or taken in the device's future (clock set back)", () => {
    expect(reminderClockSkewMs({ skewMs: 1500, sampledAt: T - REMINDER_CLOCK_SAMPLE_MAX_AGE_MS }, T)).toBe(1500);
    expect(reminderClockSkewMs({ skewMs: 1500, sampledAt: T - REMINDER_CLOCK_SAMPLE_MAX_AGE_MS - 1 }, T)).toBeNull();
    expect(reminderClockSkewMs({ skewMs: 1500, sampledAt: T + 60_000 }, T)).toBeNull();
  });
});
