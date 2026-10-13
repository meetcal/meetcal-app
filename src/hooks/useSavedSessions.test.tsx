import React from "react";
import { act, create } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSavedSessions } from "@/hooks/useSavedSessions";
import { fetchSchedule } from "@/lib/database/queries";
import {
  NOTIFICATION_ENABLED_KEY,
  cancelNotification,
  listScheduledNotifications,
  scheduleNotification,
} from "@/utils/notifications";
import { setRemindersEnabled } from "@/lib/reminder-preference";
import {
  deleteSavedSession,
  deleteSavedSessions,
  fetchSavedSessions,
  fetchUserPreferences,
  MeetCalApiError,
  putSavedSession,
} from "@/lib/api/meetcal-api";
import { getMeetData } from "@/lib/database/offline-store";
import { convertToUTC, getMeetConfig } from "@/data/meets/config";
import { clearSavedWidget, syncSavedWidget } from "@/utils/savedWidget";
import {
  countPendingWrites,
  MAX_SAVED_SESSION_ATHLETE_NAMES,
  readOutbox,
} from "@/lib/saved-sessions-outbox";
import type { LiftResult } from "@/data/types/athletes";
import type { Schedule } from "@/types/schedule";

/**
 * Clerk state the harness renders with. `null` is the cold-start case: no
 * Clerk session yet, so the hook falls back to the SecureStore hint.
 */
let mockClerkUser: { id: string } | null = null;
/** Whether Clerk has finished loading; false is "still loading". */
let mockClerkLoaded = false;
const mockGetToken = jest.fn<Promise<string | null>, []>(async () => null);

/** An unsigned JWT with `sub`; the outbox checks the subject before sending. */
function jwtFor(sub: string): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part({ sub })}.sig`;
}
const TOKEN = jwtFor("user_1");
/** Every outbox write carries its install id and rev (`convex/users.ts` orders by them). */
const WRITE_REVISION = { device: expect.any(String), rev: expect.any(Number) };

jest.mock("@clerk/expo", () => ({
  useUser: () => ({ user: mockClerkUser, isLoaded: mockClerkLoaded }),
  useAuth: () => ({ getToken: mockGetToken }),
}));

const mockNetworkListeners = new Set<(isConnected: boolean) => void>();
/** Reports a network change to every subscriber. */
const mockNetworkListener = (isConnected: boolean) => {
  for (const listener of [...mockNetworkListeners]) listener(isConnected);
};
let mockIsNetworkAvailable = true;
jest.mock("@/lib/networkUtils", () => ({
  subscribeToNetworkChanges: (callback: (isConnected: boolean) => void) => {
    mockNetworkListeners.add(callback);
    return () => {
      mockNetworkListeners.delete(callback);
    };
  },
  isNetworkAvailable: async () => mockIsNetworkAvailable,
}));

/** `null` is RevenueCat still loading. */
let mockIsSubscribed: boolean | null = true;
/** RevenueCat's own answer (`null`: not yet), and the account it was about. */
let mockConfirmedIsSubscribed: boolean | null = true;
let mockConfirmedFor = "user_1";
jest.mock("@/contexts/SubscriptionContext", () => ({
  useSubscription: () => ({
    isSubscribed: mockIsSubscribed,
    confirmedEntitlement:
      mockConfirmedIsSubscribed === null
        ? null
        : { appUserId: mockConfirmedFor, isSubscribed: mockConfirmedIsSubscribed },
  }),
}));

/** The selected meet's schedule, as the schedule resource would serve it. */
let mockSelectedMeetSchedule: unknown[] = [];
jest.mock("@/hooks/useScheduleData", () => ({
  useScheduleData: (meet: string | null) => ({
    schedule: meet ? mockSelectedMeetSchedule : [],
    isLoading: false,
  }),
}));

// Reconnect replays are jittered in production; no delay in tests.
jest.mock("@/lib/data/mutable-resource", () => ({
  reconnectRefetchDelayMs: () => 0,
}));

let mockSelectedMeet: string | null = null;
jest.mock("@/contexts/SelectedMeetContext", () => ({
  useSelectedMeet: () => ({ selectedMeet: mockSelectedMeet }),
}));

jest.mock("@/lib/database/queries", () => ({
  fetchSchedule: jest.fn(),
}));

jest.mock("@/lib/database/offline-store", () => ({
  getMeetData: jest.fn(async () => ({ schedule: null })),
  getMeetSchedule: jest.fn(async () => []),
}));

jest.mock("@/lib/authCache", () => ({
  getCachedAuthState: jest.fn(async () => ({
    isSignedIn: true,
    userId: "user_1",
  })),
}));

jest.mock("@/lib/posthog", () => ({ posthog: { capture: jest.fn() } }));

jest.mock("@/utils/savedWidget", () => ({
  syncSavedWidget: jest.fn(),
  clearSavedWidget: jest.fn(),
}));

jest.mock("@/utils/appIntents", () => ({ reindexAppEntities: jest.fn() }));

jest.mock("@/utils/notifications", () => ({
  NOTIFICATION_ENABLED_KEY: "notificationsEnabled",
  scheduleNotification: jest.fn(async () => "notification-id"),
  cancelNotification: jest.fn(async () => undefined),
  listScheduledNotifications: jest.fn(async () => []),
}));

jest.mock("@/data/meets/config", () => ({
  getMeetConfig: jest.fn(async () => ({
    time: { timeZoneIdentifier: "America/New_York" },
  })),
  convertToUTC: jest.fn(() => new Date("2099-01-01T15:00:00.000Z")),
}));

jest.mock("@/lib/api/meetcal-api", () => {
  class MeetCalApiError extends Error {
    status: number;
    body: string;
    constructor(message: string, status: number, body: string) {
      super(message);
      this.name = "MeetCalApiError";
      this.status = status;
      this.body = body;
    }
  }
  class MeetCalApiTimeoutError extends Error {}
  return {
    MeetCalApiError,
    MeetCalApiTimeoutError,
    deleteSavedSession: jest.fn(async () => ({ deleted: true })),
    deleteSavedSessions: jest.fn(async () => ({ deleted_count: 0 })),
    fetchSavedSessions: jest.fn(async () => []),
    fetchUserPreferences: jest.fn(async () => ({
      auto_unsave_started_sessions: false,
    })),
    // The prune needs a fresh server clock sample; the server agrees with
    // the device here.
    refreshServerClock: async () => ({ skewMs: 0, sampledAt: Date.now() }),
    // The reminders correct by the last sample: none yet here.
    getServerClockSample: () => null,
    MAX_PLAUSIBLE_CLOCK_SKEW_MS: 15 * 60 * 1000,
    putSavedSession: jest.fn(async (_token: string, id: string) => ({
      session_id: id,
      updated_at: 1,
    })),
  };
});

const mockFetchSavedSessions = fetchSavedSessions as jest.MockedFunction<
  typeof fetchSavedSessions
>;
const mockFetchUserPreferences = fetchUserPreferences as jest.MockedFunction<
  typeof fetchUserPreferences
>;
const mockPutSavedSession = putSavedSession as jest.MockedFunction<
  typeof putSavedSession
>;
const mockDeleteSavedSession = deleteSavedSession as jest.MockedFunction<
  typeof deleteSavedSession
>;
const mockDeleteSavedSessions = deleteSavedSessions as jest.MockedFunction<
  typeof deleteSavedSessions
>;
const mockGetMeetData = getMeetData as jest.MockedFunction<typeof getMeetData>;
const mockConvertToUTC = convertToUTC as jest.MockedFunction<typeof convertToUTC>;

// A future session start by default. `clearAllMocks` keeps implementations,
// so a test that moves the session into the past (no reminder) would
// otherwise leak into whichever test runs next (fails under `--randomize`).
beforeEach(() => {
  mockConvertToUTC.mockReturnValue(new Date("2099-01-01T15:00:00.000Z"));
  mockClerkLoaded = false;
  mockIsNetworkAvailable = true;
  mockIsSubscribed = true;
  mockConfirmedIsSubscribed = true;
  mockConfirmedFor = "user_1";
  mockSelectedMeetSchedule = [];
  mockListScheduled.mockResolvedValue([]);
});

const mockListScheduled = listScheduledNotifications as jest.MockedFunction<
  typeof listScheduledNotifications
>;

const mockFetchSchedule = fetchSchedule as jest.MockedFunction<
  typeof fetchSchedule
>;

/** Three sessions on one day, so "save all" produces three saved sessions. */
const SCHEDULE: Schedule = [
  {
    date: "June 20, 2099",
    fullDate: "2099-06-20",
    sessions: [1, 2, 3].map((number) => ({
      id: `Test Meet-${number}`,
      number,
      startTime: "10:00 AM",
      weighInTime: "8:00 AM",
      platforms: [
        {
          platform: "Red",
          weightClass: "71kg",
          platformStartTime: "10:00 AM",
        },
      ],
    })),
  },
] as unknown as Schedule;

const ATHLETES: LiftResult[] = [1, 2, 3].map((number) => ({
  memberId: String(number),
  name: `Athlete ${number}`,
  age: 25,
  club: "Club",
  gender: "Women",
  weightClass: "71kg",
  entryTotal: 200,
  adaptive: false,
  session: { number, platform: "Red" },
})) as unknown as LiftResult[];

type Hook = ReturnType<typeof useSavedSessions>;

/** Drain every queued microtask (AsyncStorage's mock is promise-based) twice over. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 3; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

/**
 * Every harness mounted by a test, unmounted after it: a hook left mounted
 * keeps listening (network, reminder preference) and acts on the next test.
 */
const mountedRenderers: ReturnType<typeof create>[] = [];
afterEach(async () => {
  const renderers = mountedRenderers.splice(0);
  await act(async () => {
    for (const renderer of renderers) renderer.unmount();
  });
});

async function mountHook(): Promise<{
  current: Hook;
  renders: number;
  rerender: () => Promise<void>;
}> {
  const ref = {
    current: null as unknown as Hook,
    renders: 0,
    rerender: async () => {},
  };
  function Harness() {
    ref.current = useSavedSessions();
    ref.renders += 1;
    return null;
  }
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(<Harness />);
  });
  mountedRenderers.push(renderer!);
  ref.rerender = async () => {
    await act(async () => {
      renderer.update(<Harness />);
    });
    await flush();
  };
  await flush();
  return ref;
}

const SESSION_KEY = "@saved_sessions_user_1";

function makeSession(id: string, overrides: Partial<Hook["savedSessions"][number]> = {}) {
  return {
    id,
    meet: "Test Meet" as never,
    sessionNumber: 1,
    platform: "Red",
    weightClass: "71kg",
    startTime: "10:00 AM",
    weighInTime: "8:00 AM",
    date: "2099-06-20",
    ...overrides,
  };
}

function apiRow(id: string) {
  return {
    session_id: id,
    meet: "Test Meet",
    session_number: 1,
    platform: "Red",
    weight_class: "71kg",
    start_time: "10:00 AM",
    date: "2099-06-20",
    notes: null,
    athlete_names: [],
    updated_at: 1,
  };
}

describe("saveAllFromAthletes", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockClerkUser = null;
    mockGetToken.mockResolvedValue(null);
    await AsyncStorage.clear();
    await AsyncStorage.setItem(NOTIFICATION_ENABLED_KEY, "true");
    mockFetchSchedule.mockResolvedValue(SCHEDULE);
  });

  it("fetches the meet schedule once for the whole batch", async () => {
    const hook = await mountHook();

    let result = { total: 0, saved: 0 };
    await act(async () => {
      result = await hook.current.saveAllFromAthletes(
        ATHLETES,
        "Test Meet" as never,
      );
    });

    expect(mockFetchSchedule).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ total: 3, saved: 3 });
    expect(hook.current.savedSessions).toHaveLength(3);
  });

  it("does not fetch at all when the caller supplies the schedule", async () => {
    const hook = await mountHook();

    await act(async () => {
      await hook.current.saveAllFromAthletes(
        ATHLETES,
        "Test Meet" as never,
        SCHEDULE,
      );
    });

    expect(mockFetchSchedule).not.toHaveBeenCalled();
    expect(hook.current.savedSessions).toHaveLength(3);
  });

  it("does not fetch the schedule for a single save", async () => {
    const hook = await mountHook();

    await act(async () => {
      await hook.current.saveSession(makeSession("Test Meet-1-Red"));
    });

    // The reminder reads the device's copy of the schedule, never the network.
    expect(mockFetchSchedule).not.toHaveBeenCalled();
  });

  it("records the whole batch in one write and sends it in one flush", async () => {
    mockClerkUser = { id: "user_1" };
    mockGetToken.mockResolvedValue(TOKEN);
    mockFetchSavedSessions.mockResolvedValue([]);
    const hook = await mountHook();
    const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
    setItem.mockClear();
    mockGetToken.mockClear();

    await act(async () => {
      await hook.current.saveAllFromAthletes(ATHLETES, "Test Meet" as never, SCHEDULE);
    });

    expect(setItem.mock.calls.filter(([key]) => key === SESSION_KEY)).toHaveLength(1);
    expect(mockPutSavedSession).toHaveBeenCalledTimes(3);
    expect(countPendingWrites(await readOutbox("user_1"))).toBe(0);
  });

  it("schedules a reminder for every saved session once the batch is published", async () => {
    const hook = await mountHook();

    await act(async () => {
      await hook.current.saveAllFromAthletes(ATHLETES, "Test Meet" as never, SCHEDULE);
    });
    await flush();

    expect(scheduleNotification).toHaveBeenCalledTimes(3);
    expect(hook.current.savedSessions).toHaveLength(3);
  });

  describe("a change that lands while the schedule is loading", () => {
    const SESSION_3 = "Test-Meet-3-Red";

    /**
     * Seeds session 3 with the user's own notes and a hand-added athlete,
     * then starts the batch and holds it in the schedule fetch, before any
     * row is merged.
     */
    async function startHeldBatch() {
      await AsyncStorage.setItem(
        SESSION_KEY,
        JSON.stringify([
          makeSession(SESSION_3, {
            sessionNumber: 3,
            notes: "before",
            athleteNames: ["Hand Pick"],
          }),
        ]),
      );
      let release: () => void = () => {};
      mockFetchSchedule.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(SCHEDULE);
          }),
      );
      const hook = await mountHook();
      let batch: Promise<{ total: number; saved: number }> = Promise.resolve({ total: 0, saved: 0 });
      await act(async () => {
        batch = hook.current.saveAllFromAthletes(ATHLETES, "Test Meet" as never);
      });
      await flush();
      expect(mockFetchSchedule).toHaveBeenCalledTimes(1);
      return {
        hook,
        finish: async () => {
          let result = { total: 0, saved: 0 };
          await act(async () => {
            release();
            result = await batch;
          });
          return result;
        },
      };
    }

    const stored = async () =>
      JSON.parse((await AsyncStorage.getItem(SESSION_KEY)) ?? "[]") as Hook["savedSessions"];

    it("merges over an edit saved meanwhile instead of the old list", async () => {
      const { hook, finish } = await startHeldBatch();

      await act(async () => {
        await hook.current.saveSession(
          makeSession(SESSION_3, {
            sessionNumber: 3,
            notes: "after",
            athleteNames: ["Hand Pick", "Late Pick"],
          }),
        );
      });
      await expect(finish()).resolves.toEqual({ total: 3, saved: 3 });

      const row = (await stored()).find((s) => s.id === SESSION_3);
      expect(row?.notes).toBe("after");
      expect(row?.athleteNames).toEqual(["Hand Pick", "Late Pick", "Athlete 3"]);
      expect(hook.current.savedSessions.find((s) => s.id === SESSION_3)?.notes).toBe("after");
      const outbox = await readOutbox("user_1");
      expect(outbox.sessions[SESSION_3]).toMatchObject({
        op: "put",
        session: expect.objectContaining({ notes: "after" }),
      });
    });

    it("does not bring back the notes and names of a session unsaved meanwhile", async () => {
      const { hook, finish } = await startHeldBatch();

      await act(async () => {
        await hook.current.removeSession(SESSION_3);
      });
      await expect(finish()).resolves.toEqual({ total: 3, saved: 3 });

      // The batch still saves session 3 (its athlete is entered in it), but
      // as a fresh row: nothing of the row the user removed comes back.
      const row = (await stored()).find((s) => s.id === SESSION_3);
      expect(row).toBeDefined();
      expect(row?.notes).toBeUndefined();
      expect(row?.athleteNames).toEqual(["Athlete 3"]);
      expect(hook.current.savedSessions.find((s) => s.id === SESSION_3)?.notes).toBeUndefined();
    });
  });
});


describe("saved-session cache validation", () => {
  const validSession = {
    id: "Test Meet-1-Red",
    meet: "Test Meet",
    sessionNumber: 1,
    platform: "Red",
    weightClass: "71kg",
    startTime: "10:00 AM",
    weighInTime: "8:00 AM",
    date: "2099-06-20",
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockClerkUser = null;
    mockGetToken.mockResolvedValue(null);
    await AsyncStorage.clear();
  });

  it("drops only rows with no usable identity, keeping valid and legacy sessions", async () => {
    const legacy = { ...validSession, id: "legacy", athleteName: "Athlete One" };
    const current = { ...validSession, id: "current", athleteNames: ["Athlete Two"] };
    const unidentifiable = [
      { id: "partial", meet: "Test Meet" },
      { ...validSession, id: 123 },
      { ...validSession, id: "" },
      { ...validSession, meet: {} },
      { ...validSession, sessionNumber: 1.5 },
      { ...validSession, sessionNumber: -1 },
      { ...validSession, platform: null },
      null,
      "row",
    ];
    await AsyncStorage.setItem(
      "@saved_sessions_user_1",
      JSON.stringify([...unidentifiable, legacy, current]),
    );
    const hook = await mountHook();
    expect(hook.current.savedSessions).toEqual([legacy, current]);
  });

  it("normalises nullable fields instead of dropping the session", async () => {
    // `weightClass: null` is what the app itself used to write from a schedule
    // row with a null weight class; dropping it lost the user's save.
    const written = {
      ...validSession,
      id: "nullable",
      sessionNumber: "2",
      weightClass: null,
      startTime: undefined,
      date: {},
      notes: null,
      athleteName: {},
      athleteNames: ["Athlete", 123],
    };
    await AsyncStorage.setItem("@saved_sessions_user_1", JSON.stringify([written]));
    const hook = await mountHook();
    expect(hook.current.savedSessions).toEqual([
      {
        id: "nullable",
        meet: "Test Meet",
        sessionNumber: 2,
        platform: "Red",
        weightClass: "",
        startTime: "",
        weighInTime: "8:00 AM",
        date: "",
        athleteNames: ["Athlete"],
      },
    ]);
  });

  it.each(["{", "null", '{}', '"sessions"'])("ignores malformed cache %s", async (raw) => {
    await AsyncStorage.setItem("@saved_sessions_user_1", raw);
    const hook = await mountHook();
    expect(hook.current.savedSessions).toEqual([]);
  });
});

describe("server reconcile with the pending-writes outbox", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    mockClerkUser = { id: "user_1" };
    mockGetToken.mockResolvedValue(TOKEN);
    // `clearAllMocks` keeps implementations, so a test's permanent rejection
    // would otherwise leak into the next one.
    mockPutSavedSession.mockReset();
    mockPutSavedSession.mockImplementation(async (_token, id) => ({
      session_id: id,
      updated_at: 1,
    }));
    mockFetchSavedSessions.mockReset();
    mockFetchSavedSessions.mockResolvedValue([]);
    mockFetchUserPreferences.mockResolvedValue({ auto_unsave_started_sessions: false });
    mockConvertToUTC.mockReturnValue(new Date("2099-01-01T15:00:00.000Z"));
    await AsyncStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps a dirty local row through a non-empty server list while its PUT still fails", async () => {
    // Saved while the PUT was failing: the row is local and queued.
    await AsyncStorage.setItem(
      SESSION_KEY,
      JSON.stringify([makeSession("Test-Meet-1-Red"), makeSession("Test-Meet-2-Red", { sessionNumber: 2 })]),
    );
    await AsyncStorage.setItem(
      "@saved_sessions_outbox_user_1",
      JSON.stringify({
        sessions: {
          "Test-Meet-2-Red": {
            op: "put",
            rev: 1,
            meet: "Test Meet",
            session: makeSession("Test-Meet-2-Red", { sessionNumber: 2 }),
          },
        },
        resets: {},
        nextRev: 2,
      }),
    );
    // The replay on load fails again; the server only knows the first row.
    mockPutSavedSession.mockRejectedValueOnce(new MeetCalApiError("down", 503, ""));
    mockFetchSavedSessions.mockResolvedValue([apiRow("Test-Meet-1-Red")]);

    const hook = await mountHook();

    // Before the outbox the reconcile replaced local state with the server's
    // list and the offline save was gone for good.
    expect(hook.current.savedSessions.map((s) => s.id).sort()).toEqual([
      "Test-Meet-1-Red",
      "Test-Meet-2-Red",
    ]);
    expect(mockPutSavedSession).toHaveBeenCalledWith(
      TOKEN,
      "Test-Meet-2-Red",
      expect.objectContaining({ session_number: 2 }),
      WRITE_REVISION,
    );
    expect(countPendingWrites(await readOutbox("user_1"))).toBe(1);
  });

  it("keeps a session saved while the reconcile's fetch was in flight", async () => {
    const hook = await mountHook();
    let resolveFetch: (rows: ReturnType<typeof apiRow>[]) => void = () => {};
    mockFetchSavedSessions.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    let loading: Promise<void> = Promise.resolve();
    await act(async () => {
      loading = hook.current.loadSavedSessions();
      await new Promise((r) => setTimeout(r, 0));
    });
    // The save's PUT lands (and its outbox entry clears) before the older
    // list the fetch is about to return.
    await act(async () => {
      await hook.current.saveSession(makeSession("Test-Meet-2-Red", { sessionNumber: 2 }));
    });
    await act(async () => {
      resolveFetch([apiRow("Test-Meet-1-Red")]);
      await loading;
    });

    expect(hook.current.savedSessions.map((s) => s.id).sort()).toEqual([
      "Test-Meet-1-Red",
      "Test-Meet-2-Red",
    ]);
  });

  it("leaves the outbox entry in place when the PUT fails and still reports the local save", async () => {
    mockPutSavedSession.mockRejectedValue(new Error("offline"));
    const hook = await mountHook();

    let saved = false;
    await act(async () => {
      saved = await hook.current.saveSession(makeSession("Test-Meet-1-Red"));
    });

    expect(saved).toBe(true);
    expect((await readOutbox("user_1")).sessions["Test-Meet-1-Red"]).toMatchObject({ op: "put" });
    expect(countPendingWrites(await readOutbox("user_1"))).toBe(1);
  });

  it("reports a save the server refuses instead of claiming success", async () => {
    const hook = await mountHook();
    mockPutSavedSession.mockRejectedValueOnce(
      new MeetCalApiError("too many saved sessions", 400, '{"error":"too many saved sessions","max":500}'),
    );

    let saved = true;
    await act(async () => {
      saved = await hook.current.saveSession(makeSession("Test-Meet-1-Red"));
    });

    expect(saved).toBe(false);
    expect(countPendingWrites(await readOutbox("user_1"))).toBe(0);
    expect(scheduleNotification).not.toHaveBeenCalled();
    // Rolled back locally: not shown as saved, so it cannot vanish later.
    expect(hook.current.savedSessions).toEqual([]);
    expect(hook.current.isSessionSaved("Test-Meet-1-Red")).toBe(false);
  });

  it("restores the previous version when the server refuses an edit", async () => {
    const hook = await mountHook();
    await act(async () => {
      await hook.current.saveSession(makeSession("Test-Meet-1-Red", { notes: "kept" }));
    });
    mockPutSavedSession.mockRejectedValueOnce(new MeetCalApiError("notes too long", 400, ""));

    let saved = true;
    await act(async () => {
      saved = await hook.current.saveSession(makeSession("Test-Meet-1-Red", { notes: "x".repeat(5000) }));
    });

    expect(saved).toBe(false);
    expect(hook.current.savedSessions.map((s) => s.notes)).toEqual(["kept"]);
  });

  it("fails a save the outbox cannot queue and leaves the saved version in place", async () => {
    const hook = await mountHook();
    await act(async () => {
      await hook.current.saveSession(makeSession("Test-Meet-1-Red", { notes: "kept" }));
    });
    mockPutSavedSession.mockClear();

    // Session number 0 is unreadable to the outbox (and the list), so the
    // mark rejects before anything is written or sent.
    let saved = true;
    await act(async () => {
      saved = await hook.current.saveSession(makeSession("Test-Meet-1-Red", { sessionNumber: 0, notes: "lost" }));
    });

    expect(saved).toBe(false);
    expect(mockPutSavedSession).not.toHaveBeenCalled();
    expect(hook.current.savedSessions.map((s) => s.notes)).toEqual(["kept"]);
    expect(countPendingWrites(await readOutbox("user_1"))).toBe(0);
  });

  it("drops a clean local row the server no longer has, even when the list is empty", async () => {
    // First reconcile on this build: server already has the row, so nothing
    // is adopted and the device is in step.
    mockFetchSavedSessions.mockResolvedValue([apiRow("Test-Meet-1-Red")]);
    const hook = await mountHook();
    expect(hook.current.savedSessions).toHaveLength(1);

    // Deleted on another device.
    mockFetchSavedSessions.mockResolvedValue([]);
    await act(async () => {
      await hook.current.loadSavedSessions();
    });

    expect(hook.current.savedSessions).toEqual([]);
    expect(mockPutSavedSession).not.toHaveBeenCalled();
  });

  it("uploads rows from a pre-outbox build once when the server has none", async () => {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify([makeSession("Test-Meet-1-Red")]));
    mockFetchSavedSessions.mockResolvedValue([]);

    const hook = await mountHook();

    expect(hook.current.savedSessions.map((s) => s.id)).toEqual(["Test-Meet-1-Red"]);
    expect(mockPutSavedSession).toHaveBeenCalledWith(TOKEN, "Test-Meet-1-Red", expect.anything(), WRITE_REVISION);
    expect(countPendingWrites(await readOutbox("user_1"))).toBe(0);
  });

  it("shares one in-flight load between concurrent callers", async () => {
    const hook = await mountHook();
    mockFetchSavedSessions.mockClear();

    await act(async () => {
      await Promise.all([hook.current.loadSavedSessions(), hook.current.loadSavedSessions()]);
    });

    expect(mockFetchSavedSessions).toHaveBeenCalledTimes(1);
  });

  it("does not repaint the previous user's sessions after sign-out mid-load", async () => {
    let resolveFetch: (rows: ReturnType<typeof apiRow>[]) => void = () => {};
    mockFetchSavedSessions.mockImplementation(
      () => new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const hook = await mountHook();

    mockClerkUser = null;
    const { getCachedAuthState } = jest.requireMock("@/lib/authCache");
    getCachedAuthState.mockResolvedValueOnce({ isSignedIn: false, userId: null });
    await hook.rerender();
    await act(async () => {
      resolveFetch([apiRow("Test-Meet-1-Red")]);
    });
    await flush();

    expect(hook.current.savedSessions).toEqual([]);
  });

  it("replays the outbox when the network comes back", async () => {
    mockPutSavedSession.mockRejectedValueOnce(new Error("offline"));
    const hook = await mountHook();
    await act(async () => {
      await hook.current.saveSession(makeSession("Test-Meet-1-Red"));
    });
    expect(countPendingWrites(await readOutbox("user_1"))).toBe(1);
    mockPutSavedSession.mockClear();

    // A connected report that is not an offline → online edge (NetInfo sends
    // the current state on subscribe) does not trigger a replay.
    await act(async () => {
      mockNetworkListener?.(true);
    });
    await flush();
    expect(mockPutSavedSession).not.toHaveBeenCalled();

    await act(async () => {
      mockNetworkListener?.(false);
      mockNetworkListener?.(true);
    });
    await flush();

    expect(mockPutSavedSession).toHaveBeenCalledWith(TOKEN, "Test-Meet-1-Red", expect.anything(), WRITE_REVISION);
    expect(countPendingWrites(await readOutbox("user_1"))).toBe(0);
  });

  it("caps athlete_names at the backend limit locally and on the wire", async () => {
    const hook = await mountHook();
    const names = Array.from({ length: MAX_SAVED_SESSION_ATHLETE_NAMES + 5 }, (_, i) => `A${i}`);

    await act(async () => {
      await hook.current.saveSession(makeSession("Test-Meet-1-Red", { athleteNames: names }));
    });

    const body = mockPutSavedSession.mock.calls[0][2];
    expect(body.athlete_names).toHaveLength(MAX_SAVED_SESSION_ATHLETE_NAMES);
    expect(hook.current.savedSessions[0].athleteNames).toHaveLength(MAX_SAVED_SESSION_ATHLETE_NAMES);
  });

  it("flags an expired session on 401 instead of only logging", async () => {
    mockFetchSavedSessions.mockRejectedValue(new MeetCalApiError("expired", 401, ""));
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify([makeSession("Test-Meet-1-Red")]));

    const hook = await mountHook();

    expect(hook.current.authExpired).toBe(true);
    // Local rows are untouched by an auth failure.
    expect(hook.current.savedSessions).toHaveLength(1);
  });

  it("clears the expired flag once the server answers again", async () => {
    mockFetchSavedSessions.mockRejectedValueOnce(new MeetCalApiError("expired", 401, ""));
    const hook = await mountHook();
    expect(hook.current.authExpired).toBe(true);

    mockFetchSavedSessions.mockResolvedValue([apiRow("Test-Meet-1-Red")]);
    await act(async () => {
      await hook.current.loadSavedSessions();
    });

    expect(hook.current.authExpired).toBe(false);
  });

  it("reconciles with the server when Clerk resolves the id the cache already gave", async () => {
    // Cold start: the SecureStore hint says user_1, Clerk has nothing yet.
    mockClerkUser = null;
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify([makeSession("Test-Meet-1-Red")]));
    const hook = await mountHook();
    expect(hook.current.savedSessions).toHaveLength(1);
    expect(mockFetchSavedSessions).not.toHaveBeenCalled();

    // Clerk finishes loading with the same id. `activeUserId` does not change,
    // which is exactly why the old effect never re-ran here.
    mockClerkUser = { id: "user_1" };
    mockFetchSavedSessions.mockResolvedValue([apiRow("Test-Meet-1-Red"), apiRow("Test-Meet-2-Red")]);
    await hook.rerender();

    expect(mockFetchSavedSessions).toHaveBeenCalledTimes(1);
    expect(hook.current.savedSessions).toHaveLength(2);

    // ...and a render with nothing new does not load again.
    await hook.rerender();
    expect(mockFetchSavedSessions).toHaveBeenCalledTimes(1);
  });

  it("cancels the reminder of a session the auto-unsave prune removes", async () => {
    await AsyncStorage.setItem(NOTIFICATION_ENABLED_KEY, "true");
    mockListScheduled.mockResolvedValue([
      { identifier: "Test-Meet-1-Red", data: { identifier: "Test-Meet-1-Red" } },
    ]);
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify([makeSession("Test-Meet-1-Red")]));
    mockFetchUserPreferences.mockResolvedValue({ auto_unsave_started_sessions: true });
    // Started long ago, so it is past the auto-unsave window.
    mockConvertToUTC.mockReturnValue(new Date("2000-01-01T15:00:00.000Z"));

    const hook = await mountHook();

    expect(hook.current.savedSessions).toEqual([]);
    expect(cancelNotification).toHaveBeenCalledWith("Test-Meet-1-Red");
  });

  it("prunes only once RevenueCat confirms the subscription, not on the cached hint", async () => {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify([makeSession("Test-Meet-1-Red")]));
    mockFetchUserPreferences.mockResolvedValue({ auto_unsave_started_sessions: true });
    mockConvertToUTC.mockReturnValue(new Date("2000-01-01T15:00:00.000Z"));
    // Started from the cache: subscribed, but RevenueCat has not answered.
    mockConfirmedIsSubscribed = null;

    const hook = await mountHook();
    expect(hook.current.savedSessions.map((s) => s.id)).toEqual(["Test-Meet-1-Red"]);
    expect(deleteSavedSession).not.toHaveBeenCalled();

    mockConfirmedIsSubscribed = true;
    await hook.rerender();

    expect(hook.current.savedSessions).toEqual([]);
  });

  it("never prunes on the previous account's confirmed subscription after a switch", async () => {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify([makeSession("Test-Meet-1-Red")]));
    mockFetchUserPreferences.mockResolvedValue({ auto_unsave_started_sessions: true });
    mockConvertToUTC.mockReturnValue(new Date("2000-01-01T15:00:00.000Z"));
    // RevenueCat last answered for the subscriber who was signed in before.
    mockConfirmedFor = "user_0";

    const hook = await mountHook();

    expect(hook.current.savedSessions.map((s) => s.id)).toEqual(["Test-Meet-1-Red"]);
    expect(deleteSavedSession).not.toHaveBeenCalled();
  });

  it("loads again after a load in flight when RevenueCat confirms mid-load", async () => {
    mockConfirmedIsSubscribed = null;
    let release!: () => void;
    mockFetchSavedSessions.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = () => resolve([]);
      }),
    );
    const hook = await mountHook();
    expect(mockFetchSavedSessions).toHaveBeenCalledTimes(1);

    // Confirmed while the first load still waits on the server.
    mockConfirmedIsSubscribed = true;
    await hook.rerender();
    await act(async () => release());
    await flush();

    // Not joined: a second load ran after the first, with its own prune.
    expect(mockFetchSavedSessions).toHaveBeenCalledTimes(2);
  });

  it("never prunes for a lapse RevenueCat reports, though the cache says subscribed", async () => {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify([makeSession("Test-Meet-1-Red")]));
    mockFetchUserPreferences.mockResolvedValue({ auto_unsave_started_sessions: true });
    mockConvertToUTC.mockReturnValue(new Date("2000-01-01T15:00:00.000Z"));
    mockConfirmedIsSubscribed = false;

    const hook = await mountHook();

    expect(hook.current.savedSessions.map((s) => s.id)).toEqual(["Test-Meet-1-Red"]);
    expect(deleteSavedSession).not.toHaveBeenCalled();
  });

  it("keeps local sessions and does not shrink storage when getToken() rejects", async () => {
    // Clerk can throw from `getToken()` (offline, a session refresh mid-flight).
    // That is neither "no token" nor "the server says you have nothing", so
    // the local list must survive untouched and nothing may reach the API.
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify([makeSession("Test-Meet-1-Red")]));
    const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
    const removeItem = AsyncStorage.removeItem as jest.MockedFunction<
      typeof AsyncStorage.removeItem
    >;
    setItem.mockClear();
    removeItem.mockClear();
    mockFetchSavedSessions.mockResolvedValue([]);
    mockGetToken.mockRejectedValue(new Error("Clerk: token refresh failed"));

    const hook = await mountHook();

    expect(mockFetchSavedSessions).not.toHaveBeenCalled();
    expect(mockFetchUserPreferences).not.toHaveBeenCalled();
    expect(hook.current.savedSessions.map((s) => s.id)).toEqual(["Test-Meet-1-Red"]);
    expect(hook.current.isLoading).toBe(false);
    expect(setItem.mock.calls.some(([key]) => key === SESSION_KEY)).toBe(false);
    expect(removeItem.mock.calls.some(([key]) => key === SESSION_KEY)).toBe(false);
    expect(JSON.parse((await AsyncStorage.getItem(SESSION_KEY)) ?? "[]")).toHaveLength(1);
  });

  it("does not reconcile with a token issued for a different user", async () => {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify([makeSession("Test-Meet-1-Red")]));
    mockFetchSavedSessions.mockResolvedValue([apiRow("Someone-Elses-1-Red")]);
    // Clerk already hands out the next account's token.
    mockGetToken.mockResolvedValue(jwtFor("user_2"));

    const hook = await mountHook();

    expect(mockFetchSavedSessions).not.toHaveBeenCalled();
    expect(hook.current.savedSessions.map((s) => s.id)).toEqual(["Test-Meet-1-Red"]);
    expect(JSON.parse((await AsyncStorage.getItem(SESSION_KEY)) ?? "[]")).toHaveLength(1);
  });

  it("does not prune with a token issued for a different user", async () => {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify([makeSession("Test-Meet-1-Red")]));
    mockFetchUserPreferences.mockResolvedValue({ auto_unsave_started_sessions: true });
    mockConvertToUTC.mockReturnValue(new Date("2000-01-01T15:00:00.000Z"));
    // Clerk already hands out the next account's token.
    mockGetToken.mockResolvedValue(jwtFor("user_2"));

    const hook = await mountHook();

    expect(mockFetchUserPreferences).not.toHaveBeenCalled();
    expect(hook.current.savedSessions.map((s) => s.id)).toEqual(["Test-Meet-1-Red"]);
    // Nothing was queued for deletion. (The row's one-time upload stays
    // queued too: the token is not user_1's, so it is not sent under it.)
    expect((await readOutbox("user_1")).sessions["Test-Meet-1-Red"]?.op).not.toBe("delete");
    expect(mockPutSavedSession).not.toHaveBeenCalled();
  });

  it("serialises concurrent saves so neither row is lost", async () => {
    const hook = await mountHook();

    await act(async () => {
      await Promise.all([
        hook.current.saveSession(makeSession("Test-Meet-1-Red")),
        hook.current.saveSession(makeSession("Test-Meet-2-Red", { sessionNumber: 2 })),
        hook.current.saveSession(makeSession("Test-Meet-3-Red", { sessionNumber: 3 })),
      ]);
    });

    expect(hook.current.savedSessions.map((s) => s.id).sort()).toEqual([
      "Test-Meet-1-Red",
      "Test-Meet-2-Red",
      "Test-Meet-3-Red",
    ]);
    const stored = JSON.parse((await AsyncStorage.getItem(SESSION_KEY)) ?? "[]");
    expect(stored).toHaveLength(3);
  });

  it("returns the same object and actions across renders with no state change", async () => {
    const hook = await mountHook();
    const first = hook.current;

    await hook.rerender();

    expect(hook.current).toBe(first);
    expect(hook.current.saveSession).toBe(first.saveSession);
    expect(hook.current.removeSession).toBe(first.removeSession);
  });

  it("folds legacy rows into the list once, then drops the legacy key", async () => {
    await AsyncStorage.setItem(
      "savedSessions_user_1",
      JSON.stringify([{ ...makeSession("old"), meet: undefined }]),
    );
    const hook = await mountHook();

    await act(async () => {
      await hook.current.migrateLegacySessions("Test Meet" as never);
    });

    expect(hook.current.savedSessions.map((s) => s.id)).toEqual(["Test-Meet-1-Red"]);
    await expect(AsyncStorage.getItem("savedSessions_user_1")).resolves.toBeNull();
    expect(mockPutSavedSession).toHaveBeenCalledTimes(1);
  });
});

describe("destructive writes: resets, removals and batch saves", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    mockClerkUser = { id: "user_1" };
    mockGetToken.mockResolvedValue(TOKEN);
    mockPutSavedSession.mockReset();
    mockPutSavedSession.mockImplementation(async (_token, id) => ({
      session_id: id,
      updated_at: 1,
    }));
    mockDeleteSavedSession.mockReset();
    mockDeleteSavedSession.mockResolvedValue({ deleted: true });
    mockDeleteSavedSessions.mockReset();
    mockDeleteSavedSessions.mockResolvedValue({ deleted_count: 1 });
    mockFetchSavedSessions.mockReset();
    mockFetchSavedSessions.mockResolvedValue([]);
    mockFetchUserPreferences.mockResolvedValue({ auto_unsave_started_sessions: false });
    mockFetchSchedule.mockReset();
    mockGetMeetData.mockReset();
    mockGetMeetData.mockResolvedValue({ schedule: null } as never);
    await AsyncStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const OTHER_MEET = "Other Meet";

  async function mountWithTwoMeets() {
    mockFetchSavedSessions.mockResolvedValue([
      apiRow("Test-Meet-1-Red"),
      { ...apiRow("Other-Meet-1-Red"), meet: OTHER_MEET },
    ]);
    const hook = await mountHook();
    expect(hook.current.savedSessions).toHaveLength(2);
    return hook;
  }

  it("resets one meet: only that meet's rows go, locally, on the server and in legacy storage", async () => {
    const hook = await mountWithTwoMeets();
    await AsyncStorage.setItem(
      "savedSessions_user_1",
      JSON.stringify([makeSession("legacy-a"), { ...makeSession("legacy-b"), meet: OTHER_MEET }]),
    );

    let ok = false;
    await act(async () => {
      ok = await hook.current.resetAllSessions("Test Meet" as never);
    });

    expect(ok).toBe(true);
    expect(mockDeleteSavedSessions).toHaveBeenCalledWith(TOKEN, "Test Meet", WRITE_REVISION);
    expect(hook.current.savedSessions.map((s) => s.id)).toEqual(["Other-Meet-1-Red"]);
    const stored = JSON.parse((await AsyncStorage.getItem(SESSION_KEY)) ?? "[]");
    expect(stored.map((s: { id: string }) => s.id)).toEqual(["Other-Meet-1-Red"]);
    const legacy = JSON.parse((await AsyncStorage.getItem("savedSessions_user_1")) ?? "[]");
    expect(legacy.map((s: { id: string }) => s.id)).toEqual(["legacy-b"]);
    expect(countPendingWrites(await readOutbox("user_1"))).toBe(0);
  });

  it("resets every meet with one unscoped DELETE", async () => {
    const hook = await mountWithTwoMeets();

    await act(async () => {
      await hook.current.resetAllSessions();
    });

    expect(mockDeleteSavedSessions).toHaveBeenCalledTimes(1);
    expect(mockDeleteSavedSessions).toHaveBeenCalledWith(TOKEN, undefined, WRITE_REVISION);
    expect(hook.current.savedSessions).toEqual([]);
  });

  it("keeps an offline reset queued so the next reconcile cannot bring the rows back", async () => {
    const hook = await mountWithTwoMeets();
    mockDeleteSavedSessions.mockRejectedValue(new Error("Network request failed"));

    let ok = false;
    await act(async () => {
      ok = await hook.current.resetAllSessions("Test Meet" as never);
    });
    // The reset is recorded and will be replayed; the local removal stands.
    expect(ok).toBe(true);
    expect((await readOutbox("user_1")).resets["Test Meet"]).toBeDefined();

    // The server still has both rows, because the DELETE never arrived.
    await act(async () => {
      await hook.current.loadSavedSessions();
    });
    expect(hook.current.savedSessions.map((s) => s.id)).toEqual(["Other-Meet-1-Red"]);
  });

  it("keeps a removal queued when the DELETE fails with a 5xx, and still cancels the reminder", async () => {
    const hook = await mountHook();
    await act(async () => {
      await hook.current.saveSession(makeSession("Test-Meet-1-Red"));
    });
    mockDeleteSavedSession.mockRejectedValue(new MeetCalApiError("down", 503, ""));

    let ok = false;
    await act(async () => {
      ok = await hook.current.removeSession("Test-Meet-1-Red");
    });

    expect(ok).toBe(true);
    expect(hook.current.savedSessions).toEqual([]);
    expect((await readOutbox("user_1")).sessions["Test-Meet-1-Red"]).toMatchObject({ op: "delete" });
    expect(mockDeleteSavedSession).toHaveBeenCalledWith(TOKEN, "Test-Meet-1-Red", WRITE_REVISION);
  });

  it("does not write anything without a signed-in user", async () => {
    mockClerkUser = null;
    const { getCachedAuthState } = jest.requireMock("@/lib/authCache") as {
      getCachedAuthState: jest.Mock;
    };
    getCachedAuthState.mockResolvedValueOnce(null);
    const hook = await mountHook();

    let results: boolean[] = [];
    await act(async () => {
      results = [
        await hook.current.saveSession(makeSession("Test-Meet-1-Red")),
        await hook.current.removeSession("Test-Meet-1-Red"),
        await hook.current.resetAllSessions(),
      ];
    });

    expect(results).toEqual([false, false, false]);
    expect(mockPutSavedSession).not.toHaveBeenCalled();
    expect(mockDeleteSavedSessions).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("falls back to the downloaded schedule when the schedule fetch fails", async () => {
    mockFetchSchedule.mockRejectedValue(new Error("offline"));
    mockGetMeetData.mockResolvedValue({ schedule: SCHEDULE } as never);
    const hook = await mountHook();

    let ok = false;
    await act(async () => {
      ok = (await hook.current.saveAllFromAthletes(ATHLETES, "Test Meet" as never)).saved === 3;
    });

    expect(ok).toBe(true);
    expect(mockGetMeetData).toHaveBeenCalledWith("Test Meet");
    // The schedule supplies each session's day and start time.
    expect(hook.current.savedSessions.map((s) => [s.sessionNumber, s.date, s.startTime])).toEqual([
      [1, "2099-06-20", "10:00 AM"],
      [2, "2099-06-20", "10:00 AM"],
      [3, "2099-06-20", "10:00 AM"],
    ]);
  });

  it("reports a partial batch failure but keeps the rows the server accepted", async () => {
    mockPutSavedSession.mockImplementation(async (_token, id) => {
      if (id.endsWith("-2-Red")) {
        throw new MeetCalApiError("too many saved sessions", 400, "");
      }
      return { session_id: id, updated_at: 1 };
    });
    const hook = await mountHook();

    let result = { total: 0, saved: 0 };
    await act(async () => {
      result = await hook.current.saveAllFromAthletes(ATHLETES, "Test Meet" as never, SCHEDULE);
    });

    // Two of three: the refused row is undone, the others stay saved.
    expect(result).toEqual({ total: 3, saved: 2 });
    expect(hook.current.savedSessions.map((s) => s.sessionNumber).sort()).toEqual([1, 3]);
    expect(countPendingWrites(await readOutbox("user_1"))).toBe(0);
  });
});

describe("signed-out Clerk and the cached user", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockClerkUser = null;
    mockGetToken.mockResolvedValue(null);
    await AsyncStorage.clear();
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify([makeSession("Test-Meet-1-Red")]));
  });

  it("drops the cached user's sessions and widget once Clerk loads signed out online", async () => {
    const hook = await mountHook();
    // Clerk still loading: the SecureStore hint stands in.
    expect(hook.current.savedSessions).toHaveLength(1);

    mockClerkLoaded = true;
    await hook.rerender();

    expect(hook.current.savedSessions).toEqual([]);
    expect(clearSavedWidget).toHaveBeenCalled();
  });

  it("keeps the cached user while offline, then drops them when the network returns", async () => {
    mockIsNetworkAvailable = false;
    mockClerkLoaded = true;
    const hook = await mountHook();
    expect(hook.current.savedSessions).toHaveLength(1);

    mockIsNetworkAvailable = true;
    await act(async () => {
      mockNetworkListener(false);
      mockNetworkListener(true);
    });
    await flush();

    expect(hook.current.savedSessions).toEqual([]);
  });
});

describe("session reminders follow the saved list", () => {
  const mockScheduleNotification = scheduleNotification as jest.MockedFunction<
    typeof scheduleNotification
  >;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockClerkUser = { id: "user_1" };
    mockGetToken.mockResolvedValue(TOKEN);
    mockPutSavedSession.mockReset();
    mockPutSavedSession.mockImplementation(async (_token, id) => ({
      session_id: id,
      updated_at: 1,
    }));
    mockDeleteSavedSessions.mockReset();
    mockDeleteSavedSessions.mockResolvedValue({ deleted_count: 1 });
    mockFetchSavedSessions.mockReset();
    mockFetchSavedSessions.mockResolvedValue([]);
    mockFetchUserPreferences.mockResolvedValue({ auto_unsave_started_sessions: false });
    await AsyncStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("schedules reminders for sessions saved on another device", async () => {
    mockFetchSavedSessions.mockResolvedValue([apiRow("Test-Meet-1-Red")]);

    await mountHook();

    expect(mockScheduleNotification).toHaveBeenCalledTimes(1);
    expect(mockScheduleNotification.mock.calls[0][3]).toBe("Test-Meet-1-Red");
  });

  it("schedules the saved sessions' reminders when reminders are turned on", async () => {
    await AsyncStorage.setItem(NOTIFICATION_ENABLED_KEY, "false");
    mockFetchSavedSessions.mockResolvedValue([apiRow("Test-Meet-1-Red")]);
    await mountHook();
    expect(mockScheduleNotification).not.toHaveBeenCalled();

    await act(async () => {
      await setRemindersEnabled(true);
    });
    await flush();

    expect(mockScheduleNotification).toHaveBeenCalledTimes(1);
  });

  it("gives a free user no reminders", async () => {
    mockIsSubscribed = false;
    await AsyncStorage.setItem(NOTIFICATION_ENABLED_KEY, "true");
    mockFetchSavedSessions.mockResolvedValue([apiRow("Test-Meet-1-Red")]);

    await mountHook();

    expect(mockScheduleNotification).not.toHaveBeenCalled();
  });

  it("cancels the previous user's reminders on sign-out", async () => {
    mockFetchSavedSessions.mockResolvedValue([apiRow("Test-Meet-1-Red")]);
    const hook = await mountHook();
    mockListScheduled.mockResolvedValue([
      { identifier: "Test-Meet-1-Red", data: { kind: "session-reminder", triggerAtMs: 1 } },
    ]);

    mockClerkUser = null;
    mockClerkLoaded = true;
    const { getCachedAuthState } = jest.requireMock("@/lib/authCache");
    getCachedAuthState.mockResolvedValueOnce({ isSignedIn: false, userId: null });
    await hook.rerender();

    expect(hook.current.savedSessions).toEqual([]);
    expect(cancelNotification).toHaveBeenCalledWith("Test-Meet-1-Red");
  });

  it("keeps reminders through a cold start with an expired auth hint until Clerk answers", async () => {
    mockClerkUser = null;
    const { getCachedAuthState } = jest.requireMock("@/lib/authCache");
    getCachedAuthState.mockResolvedValue(null);
    mockListScheduled.mockResolvedValue([
      { identifier: "Test-Meet-1-Red", data: { kind: "session-reminder", triggerAtMs: 1 } },
    ]);
    try {
      // Clerk still loading (or offline): "no user" is not an answer yet.
      const hook = await mountHook();
      expect(cancelNotification).not.toHaveBeenCalled();

      // Clerk loads signed out, online: now the reminders go.
      mockClerkLoaded = true;
      await hook.rerender();
      expect(cancelNotification).toHaveBeenCalledWith("Test-Meet-1-Red");
    } finally {
      getCachedAuthState.mockResolvedValue({ isSignedIn: true, userId: "user_1" });
    }
  });

  it("cancels the reminders of a reset", async () => {
    mockFetchSavedSessions.mockResolvedValue([apiRow("Test-Meet-1-Red")]);
    const hook = await mountHook();
    mockListScheduled.mockResolvedValue([
      { identifier: "Test-Meet-1-Red", data: { kind: "session-reminder", triggerAtMs: 1 } },
    ]);

    await act(async () => {
      await hook.current.resetAllSessions();
    });
    await flush();

    expect(cancelNotification).toHaveBeenCalledWith("Test-Meet-1-Red");
  });
});

describe("start times from the current schedule", () => {
  const mockSyncSavedWidget = syncSavedWidget as jest.MockedFunction<typeof syncSavedWidget>;
  const MOVED = [
    {
      date: "June 20, 2099",
      fullDate: "2099-06-20",
      sessions: [
        {
          id: "Test Meet-1",
          number: 1,
          startTime: "2:00 PM",
          weighInTime: "12:00 PM",
          platforms: [{ platform: "Red", weightClass: "71kg", platformStartTime: "2:00 PM" }],
        },
      ],
    },
  ];

  beforeEach(async () => {
    jest.clearAllMocks();
    mockClerkUser = null;
    mockGetToken.mockResolvedValue(null);
    await AsyncStorage.clear();
  });

  afterEach(() => {
    mockSelectedMeet = null;
  });

  it("hands the widget and the screens the moved time, not the one saved", async () => {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify([makeSession("Test-Meet-1-Red")]));
    mockSelectedMeet = "Test Meet";
    mockSelectedMeetSchedule = MOVED;

    const hook = await mountHook();

    expect(hook.current.savedSessions[0]).toMatchObject({
      startTime: "2:00 PM",
      weighInTime: "12:00 PM",
    });
    const [, widgetSessions] = mockSyncSavedWidget.mock.calls.at(-1) ?? [];
    expect(widgetSessions?.[0]?.startTime).toBe("2:00 PM");
    // The stored copy is not rewritten.
    const stored = JSON.parse((await AsyncStorage.getItem(SESSION_KEY)) ?? "[]");
    expect(stored[0].startTime).toBe("10:00 AM");
  });
});

describe("sync failures", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockClerkUser = { id: "user_1" };
    mockGetToken.mockResolvedValue(TOKEN);
    mockFetchSavedSessions.mockReset();
    await AsyncStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("says the list is the device's copy after a 5xx, and clears it once the server answers", async () => {
    mockFetchSavedSessions.mockRejectedValueOnce(new MeetCalApiError("down", 503, ""));
    const hook = await mountHook();
    expect(hook.current.syncFailed).toBe(true);
    expect(hook.current.authExpired).toBe(false);

    mockFetchSavedSessions.mockResolvedValue([]);
    await act(async () => {
      await hook.current.loadSavedSessions();
    });

    expect(hook.current.syncFailed).toBe(false);
  });

  it("treats a Clerk token failure as a sync failure", async () => {
    mockGetToken.mockRejectedValueOnce(new Error("offline"));
    const hook = await mountHook();
    expect(hook.current.syncFailed).toBe(true);
    expect(mockFetchSavedSessions).not.toHaveBeenCalled();
  });

  it("treats a network failure as a sync failure too", async () => {
    mockFetchSavedSessions.mockRejectedValueOnce(new Error("Network request failed"));
    const hook = await mountHook();
    expect(hook.current.syncFailed).toBe(true);
  });
});

describe("saved widget sync", () => {
  const mockGetMeetConfig = getMeetConfig as jest.MockedFunction<typeof getMeetConfig>;
  const mockSyncSavedWidget = syncSavedWidget as jest.MockedFunction<typeof syncSavedWidget>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockClerkUser = null;
    mockGetToken.mockResolvedValue(null);
    await AsyncStorage.clear();
  });

  afterEach(() => {
    mockSelectedMeet = null;
    mockGetMeetConfig.mockImplementation((async () => ({
      time: { timeZoneIdentifier: "America/New_York" },
    })) as never);
  });

  it("does not let a slow config lookup for the previous meet repaint the widget", async () => {
    let resolveMeetA: (value: unknown) => void = () => {};
    mockGetMeetConfig.mockImplementation(((meet: string) =>
      meet === "Meet A"
        ? new Promise((resolve) => {
            resolveMeetA = resolve;
          })
        : Promise.resolve({ time: { timeZoneIdentifier: "America/Denver" } })) as never);

    mockSelectedMeet = "Meet A";
    const hook = await mountHook();
    mockSelectedMeet = "Meet B";
    await hook.rerender();

    expect(mockSyncSavedWidget).toHaveBeenLastCalledWith("Meet B", expect.any(Array), "America/Denver");

    // Meet A's lookup (a network fetch) resolves after Meet B's cached one.
    await act(async () => {
      resolveMeetA({ time: { timeZoneIdentifier: "America/New_York" } });
    });
    await flush();

    expect(mockSyncSavedWidget.mock.calls.some(([meet]) => meet === "Meet A")).toBe(false);
    expect(mockSyncSavedWidget).toHaveBeenLastCalledWith("Meet B", expect.any(Array), "America/Denver");
  });

  it("passes no zone (not a UTC guess) when the meet config cannot be read", async () => {
    mockGetMeetConfig.mockRejectedValue(new Error("Meet not found"));
    mockSelectedMeet = "Meet C";
    await mountHook();

    expect(mockSyncSavedWidget).toHaveBeenLastCalledWith("Meet C", expect.any(Array), undefined);
  });

  it("passes no zone when the meet config has none", async () => {
    mockGetMeetConfig.mockResolvedValue({ time: { timeZoneIdentifier: "" } } as never);
    mockSelectedMeet = "Meet D";
    await mountHook();

    expect(mockSyncSavedWidget).toHaveBeenLastCalledWith("Meet D", expect.any(Array), undefined);
  });
});
