import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createReminderSyncRunner,
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

function reminder(id: string, triggerAtMs: number): DesiredReminder {
  return { session: saved(id), triggerAtMs };
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
      { id: "a", triggerAtMs: 5 },
      { id: "b", triggerAtMs: null },
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
      { kind: SESSION_REMINDER_KIND, triggerAtMs: Date.parse("2099-06-20T10:00:00.000Z") },
    );
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
