import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SavedSession } from "@/hooks/useSavedSessions";
import {
  deleteSavedSession,
  deleteSavedSessions,
  MeetCalApiError,
  putSavedSession,
} from "@/lib/api/meetcal-api";
import {
  capAthleteNames,
  classifySyncError,
  clearSessionPending,
  countPendingWrites,
  getSavedSessionsOutboxKey,
  markResetPending,
  markSessionPending,
  MAX_SAVED_SESSION_ATHLETE_NAMES,
  mergeServerSessions,
  readOutbox,
  replayOutbox,
  RESET_ALL_MEETS,
  toSavedSessionBody,
} from "@/lib/saved-sessions-outbox";

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
  return {
    MeetCalApiError,
    deleteSavedSession: jest.fn(async () => ({ deleted: true })),
    deleteSavedSessions: jest.fn(async () => ({ deleted_count: 0 })),
    putSavedSession: jest.fn(async (_t: string, id: string) => ({
      session_id: id,
      updated_at: 1,
    })),
  };
});

const mockPut = putSavedSession as jest.MockedFunction<typeof putSavedSession>;
const mockDelete = deleteSavedSession as jest.MockedFunction<typeof deleteSavedSession>;
const mockDeleteAll = deleteSavedSessions as jest.MockedFunction<typeof deleteSavedSessions>;

const USER = "user_1";

function session(id: string, overrides: Partial<SavedSession> = {}): SavedSession {
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

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("outbox bookkeeping", () => {
  it("marks, counts and clears by rev", async () => {
    const rev = await markSessionPending(USER, "a", "put");
    expect(countPendingWrites(await readOutbox(USER))).toBe(1);

    // A newer op on the same id supersedes; the old rev can no longer clear it.
    const newer = await markSessionPending(USER, "a", "delete");
    await clearSessionPending(USER, "a", rev);
    expect((await readOutbox(USER)).sessions.a).toEqual({ op: "delete", rev: newer });

    await clearSessionPending(USER, "a", newer);
    expect(countPendingWrites(await readOutbox(USER))).toBe(0);
    // An empty outbox leaves no key behind.
    await expect(AsyncStorage.getItem(getSavedSessionsOutboxKey(USER))).resolves.toBeNull();
  });

  it("serialises concurrent marks so none is lost", async () => {
    await Promise.all(["a", "b", "c", "d"].map((id) => markSessionPending(USER, id, "put")));
    expect(Object.keys((await readOutbox(USER)).sessions).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("a reset-all wipes per-session entries and earlier resets", async () => {
    await markSessionPending(USER, "a", "put");
    await markResetPending(USER, "Other Meet");
    await markResetPending(USER, null);
    const outbox = await readOutbox(USER);
    expect(outbox.sessions).toEqual({});
    expect(Object.keys(outbox.resets)).toEqual([RESET_ALL_MEETS]);
  });

  it.each(["{", "[]", '{"sessions":[1],"resets":"x","nextRev":-1}', '{"sessions":{"a":{"op":"nope","rev":1}}}'])(
    "treats malformed storage %s as empty",
    async (raw) => {
      await AsyncStorage.setItem(getSavedSessionsOutboxKey(USER), raw);
      expect(countPendingWrites(await readOutbox(USER))).toBe(0);
    },
  );
});

describe("mergeServerSessions", () => {
  it("keeps a dirty local row when the server has a non-empty list without it", async () => {
    await markSessionPending(USER, "local-only", "put");
    const outbox = await readOutbox(USER);
    const merged = mergeServerSessions(
      [session("server-1")],
      [session("server-1"), session("local-only")],
      outbox,
    );
    expect(merged.map((s) => s.id)).toEqual(["server-1", "local-only"]);
  });

  it("prefers the dirty local version of a row the server also has", async () => {
    await markSessionPending(USER, "shared", "put");
    const outbox = await readOutbox(USER);
    const merged = mergeServerSessions(
      [session("shared", { notes: "server" })],
      [session("shared", { notes: "local" })],
      outbox,
    );
    expect(merged[0].notes).toBe("local");
  });

  it("drops server rows pending delete or covered by a pending reset", async () => {
    await markSessionPending(USER, "gone", "delete");
    await markResetPending(USER, "Reset Meet");
    const outbox = await readOutbox(USER);
    const merged = mergeServerSessions(
      [session("gone"), session("kept"), session("reset-me", { meet: "Reset Meet" as never })],
      [],
      outbox,
    );
    expect(merged.map((s) => s.id)).toEqual(["kept"]);
  });

  it("lets the server win for a clean local-only row", () => {
    const merged = mergeServerSessions(
      [session("server-1")],
      [session("server-1"), session("removed-elsewhere")],
      { sessions: {}, resets: {}, nextRev: 1 },
    );
    expect(merged.map((s) => s.id)).toEqual(["server-1"]);
  });
});

describe("athlete name cap", () => {
  it("caps at the backend limit and leaves undefined alone", () => {
    const names = Array.from({ length: MAX_SAVED_SESSION_ATHLETE_NAMES + 10 }, (_, i) => `A${i}`);
    expect(capAthleteNames(names)).toHaveLength(MAX_SAVED_SESSION_ATHLETE_NAMES);
    expect(capAthleteNames(undefined)).toBeUndefined();
    expect(capAthleteNames(["one"])).toEqual(["one"]);
    expect(toSavedSessionBody(session("x", { athleteNames: names })).athlete_names).toHaveLength(
      MAX_SAVED_SESSION_ATHLETE_NAMES,
    );
  });
});

describe("classifySyncError", () => {
  it("separates auth, rejected and retryable failures", () => {
    expect(classifySyncError(new MeetCalApiError("x", 401, ""))).toBe("auth");
    expect(classifySyncError(new MeetCalApiError("x", 400, ""))).toBe("rejected");
    expect(classifySyncError(new MeetCalApiError("x", 422, ""))).toBe("rejected");
    expect(classifySyncError(new MeetCalApiError("x", 408, ""))).toBe("retry");
    expect(classifySyncError(new MeetCalApiError("x", 429, ""))).toBe("retry");
    expect(classifySyncError(new MeetCalApiError("x", 503, ""))).toBe("retry");
    expect(classifySyncError(new Error("network"))).toBe("retry");
  });
});

describe("replayOutbox", () => {
  it("replays resets first, then PUT/DELETE in rev order, clearing on 2xx", async () => {
    await markSessionPending(USER, "put-me", "put");
    await markSessionPending(USER, "delete-me", "delete");
    await markResetPending(USER, "Old Meet");

    const result = await replayOutbox(USER, "token", [session("put-me")]);

    expect(result).toEqual({ authExpired: false, remaining: 0, rejected: 0 });
    expect(mockDeleteAll).toHaveBeenCalledWith("token", "Old Meet");
    expect(mockPut).toHaveBeenCalledWith("token", "put-me", expect.objectContaining({ meet: "Test Meet" }));
    expect(mockDelete).toHaveBeenCalledWith("token", "delete-me");
    const order = [
      mockDeleteAll.mock.invocationCallOrder[0],
      mockPut.mock.invocationCallOrder[0],
      mockDelete.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(countPendingWrites(await readOutbox(USER))).toBe(0);
  });

  it("keeps an entry the network could not deliver", async () => {
    await markSessionPending(USER, "put-me", "put");
    mockPut.mockRejectedValueOnce(new Error("offline"));

    const result = await replayOutbox(USER, "token", [session("put-me")]);

    expect(result.remaining).toBe(1);
    expect((await readOutbox(USER)).sessions["put-me"]).toBeDefined();
  });

  it("drops an entry the server refused with 400", async () => {
    await markSessionPending(USER, "bad", "put");
    mockPut.mockRejectedValueOnce(new MeetCalApiError("bad", 400, ""));

    const result = await replayOutbox(USER, "token", [session("bad")]);

    expect(result.rejected).toBe(1);
    expect(countPendingWrites(await readOutbox(USER))).toBe(0);
  });

  it("stops at the first 401 and keeps everything", async () => {
    await markSessionPending(USER, "a", "put");
    await markSessionPending(USER, "b", "put");
    mockPut.mockRejectedValueOnce(new MeetCalApiError("expired", 401, ""));

    const result = await replayOutbox(USER, "token", [session("a"), session("b")]);

    expect(result.authExpired).toBe(true);
    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(countPendingWrites(await readOutbox(USER))).toBe(2);
  });

  it("treats a 404 on delete as done", async () => {
    await markSessionPending(USER, "already-gone", "delete");
    mockDelete.mockRejectedValueOnce(new MeetCalApiError("missing", 404, ""));

    const result = await replayOutbox(USER, "token", []);

    expect(result).toEqual({ authExpired: false, remaining: 0, rejected: 0 });
    expect(countPendingWrites(await readOutbox(USER))).toBe(0);
  });

  it("clears a PUT whose row is no longer stored locally", async () => {
    await markSessionPending(USER, "vanished", "put");

    await replayOutbox(USER, "token", []);

    expect(mockPut).not.toHaveBeenCalled();
    expect(countPendingWrites(await readOutbox(USER))).toBe(0);
  });
});
