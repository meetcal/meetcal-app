import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SavedSession } from "@/hooks/useSavedSessions";
import {
  deleteSavedSession,
  deleteSavedSessions,
  MeetCalApiError,
  putSavedSession,
} from "@/lib/api/meetcal-api";
import {
  adoptPreOutboxSessions,
  capAthleteNames,
  classifySyncError,
  clearSessionPending,
  countPendingWrites,
  describeTokenClaims,
  flushOutbox,
  getSavedSessionsOutboxKey,
  markResetPending,
  markSessionDelete,
  markSessionPut,
  MAX_SAVED_SESSION_ATHLETE_NAMES,
  mergeServerSessions,
  readOutbox,
  RESET_ALL_MEETS,
  tokenBelongsTo,
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
  class MeetCalApiTimeoutError extends Error {}
  return {
    MeetCalApiError,
    MeetCalApiTimeoutError,
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

const OTHER = "Other Meet";

/** An unsigned JWT with `sub`; the outbox only reads the subject. */
function jwtFor(sub: string): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part({ sub })}.sig`;
}
const TOKEN = jwtFor(USER);
const getToken = async () => TOKEN;

function ids(sessions: SavedSession[]): string[] {
  return sessions.map((s) => s.id);
}

describe("describeTokenClaims", () => {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

  it("reports issuer, origin, audience and time to expiry, never the subject", () => {
    const token = `${part({ alg: "RS256" })}.${part({
      sub: "user_secret",
      iss: "https://dev.clerk.test",
      azp: "https://meetcal.app",
      exp: 1_000_060,
    })}.sig`;

    const described = describeTokenClaims(token, 1_000_000_000);

    expect(described).toEqual({
      iss: "https://dev.clerk.test",
      azp: "https://meetcal.app",
      aud: undefined,
      expiresInSeconds: 60,
    });
    expect(JSON.stringify(described)).not.toContain("user_secret");
  });

  it("returns null for an unreadable token", () => {
    expect(describeTokenClaims("")).toBeNull();
    expect(describeTokenClaims("a.!!!.c")).toBeNull();
    expect(describeTokenClaims(`x.${part(["not", "an", "object"])}.y`)).toBeNull();
  });
});

describe("outbox bookkeeping", () => {
  it("marks, counts and clears by rev", async () => {
    const rev = await markSessionPut(USER, session("a"));
    expect(countPendingWrites(await readOutbox(USER))).toBe(1);

    // A newer op on the same id supersedes; the old rev can no longer clear it.
    const newer = await markSessionDelete(USER, "a", "Test Meet");
    await clearSessionPending(USER, "a", rev);
    expect((await readOutbox(USER)).sessions.a).toEqual({ op: "delete", rev: newer, meet: "Test Meet" });

    await clearSessionPending(USER, "a", newer);
    expect(countPendingWrites(await readOutbox(USER))).toBe(0);
  });

  it("never reuses a rev after the outbox empties", async () => {
    const first = await markSessionPut(USER, session("a"));
    await clearSessionPending(USER, "a", first);
    const second = await markSessionPut(USER, session("b"));
    expect(second).toBeGreaterThan(first);
  });

  it("serialises concurrent marks so none is lost", async () => {
    await Promise.all(["a", "b", "c", "d"].map((id) => markSessionPut(USER, session(id))));
    expect(Object.keys((await readOutbox(USER)).sessions).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("a meet reset supersedes that meet's earlier entries only", async () => {
    await markSessionPut(USER, session("in-meet"));
    await markSessionPut(USER, session("elsewhere", { meet: OTHER as never }));
    await markResetPending(USER, "Test Meet");
    const outbox = await readOutbox(USER);
    expect(Object.keys(outbox.sessions)).toEqual(["elsewhere"]);
    expect(Object.keys(outbox.resets)).toEqual(["Test Meet"]);
  });

  it("a reset-all wipes per-session entries and earlier resets", async () => {
    await markSessionPut(USER, session("a"));
    await markResetPending(USER, OTHER);
    await markResetPending(USER, null);
    const outbox = await readOutbox(USER);
    expect(outbox.sessions).toEqual({});
    expect(Object.keys(outbox.resets)).toEqual([RESET_ALL_MEETS]);
  });

  it.each([
    "{",
    "[]",
    '{"sessions":[1],"resets":"x","nextRev":-1}',
    '{"sessions":{"a":{"op":"nope","rev":1}}}',
    '{"sessions":{"a":{"op":"put","rev":1,"meet":"M"}}}',
  ])("treats malformed storage %s as empty", async (raw) => {
    await AsyncStorage.setItem(getSavedSessionsOutboxKey(USER), raw);
    expect(countPendingWrites(await readOutbox(USER))).toBe(0);
  });
});

describe("unreadable storage", () => {
  const getItem = AsyncStorage.getItem as jest.Mock;
  let original: ((...args: unknown[]) => unknown) | undefined;
  beforeEach(() => {
    original = getItem.getMockImplementation();
  });
  afterEach(() => {
    getItem.mockImplementation(original);
  });

  it("fails a mark instead of overwriting the queue with an empty one", async () => {
    await markSessionPut(USER, session("queued"));
    getItem.mockRejectedValueOnce(new Error("io"));

    await expect(markSessionPut(USER, session("new"))).rejects.toThrow("io");

    expect(Object.keys((await readOutbox(USER)).sessions)).toEqual(["queued"]);
  });

  it("stops a flush with the queue intact", async () => {
    await markSessionPut(USER, session("queued"));
    getItem.mockRejectedValue(new Error("io"));

    const result = await flushOutbox(USER, getToken);
    getItem.mockImplementation(original);

    expect(mockPut).not.toHaveBeenCalled();
    expect(result.remaining).toBeGreaterThan(0);
    expect(Object.keys((await readOutbox(USER)).sessions)).toEqual(["queued"]);
  });
});

describe("persisted PUT bodies", () => {
  it("normalizes an older-build body before it is replayed or merged", async () => {
    await AsyncStorage.setItem(
      getSavedSessionsOutboxKey(USER),
      JSON.stringify({
        nextRev: 3,
        resets: {},
        sessions: {
          legacy: {
            op: "put",
            rev: 1,
            meet: "Test Meet",
            session: {
              id: "legacy",
              meet: "Test Meet",
              sessionNumber: "4",
              platform: "Blue",
              weightClass: null,
              startTime: null,
              athleteNames: "Jane Doe",
            },
          },
          blank: {
            op: "put",
            rev: 2,
            meet: "Test Meet",
            session: { id: "  ", meet: "Test Meet", sessionNumber: 1, platform: "Red" },
          },
        },
      }),
    );

    const outbox = await readOutbox(USER);
    // A body with no usable identity cannot be replayed.
    expect(Object.keys(outbox.sessions)).toEqual(["legacy"]);
    const body = outbox.sessions.legacy.session!;
    expect(body).toMatchObject({
      sessionNumber: 4,
      weightClass: "",
      startTime: "",
      weighInTime: "",
      date: "",
    });
    expect(body.athleteNames).toBeUndefined();

    const merged = mergeServerSessions([], outbox);
    expect(merged).toEqual([body]);

    await flushOutbox(USER, getToken);
    expect(mockPut).toHaveBeenCalledTimes(1);
    const sent = mockPut.mock.calls[0][2];
    expect(sent.session_number).toBe(4);
    expect(sent.weight_class).toBe("");
    expect(sent.athlete_names).toBeUndefined();
  });
});

describe("mergeServerSessions", () => {
  it("keeps a pending PUT the server does not have yet, from the outbox body", async () => {
    await markSessionPut(USER, session("local-only"));
    const merged = mergeServerSessions([session("server-1")], await readOutbox(USER));
    expect(ids(merged)).toEqual(["server-1", "local-only"]);
  });

  it("prefers the pending version of a row the server also has", async () => {
    await markSessionPut(USER, session("shared", { notes: "local" }));
    const merged = mergeServerSessions([session("shared", { notes: "server" })], await readOutbox(USER));
    expect(merged[0].notes).toBe("local");
  });

  it("drops server rows pending delete or covered by a pending reset", async () => {
    await markSessionDelete(USER, "gone", "Test Meet");
    await markResetPending(USER, "Reset Meet");
    const merged = mergeServerSessions(
      [session("gone"), session("kept"), session("reset-me", { meet: "Reset Meet" as never })],
      await readOutbox(USER),
    );
    expect(ids(merged)).toEqual(["kept"]);
  });

  it("keeps a session saved after a still-pending reset of its meet", async () => {
    await markResetPending(USER, "Test Meet");
    await markSessionPut(USER, session("saved-after"));
    const merged = mergeServerSessions(
      [session("old-row"), session("saved-after")],
      await readOutbox(USER),
    );
    expect(ids(merged)).toEqual(["saved-after"]);
  });

  it("trusts an empty server list: a clean row removed elsewhere goes", () => {
    expect(mergeServerSessions([], { sessions: {}, resets: {}, nextRev: 1 })).toEqual([]);
  });
});

describe("adoptPreOutboxSessions", () => {
  it("queues pre-outbox local rows once, only when the server is empty", async () => {
    expect(await adoptPreOutboxSessions(USER, true, [session("old")])).toBe(1);
    expect(Object.keys((await readOutbox(USER)).sessions)).toEqual(["old"]);

    expect(await adoptPreOutboxSessions(USER, true, [session("again")])).toBe(0);
    expect(Object.keys((await readOutbox(USER)).sessions)).toEqual(["old"]);
  });

  it("adopts nothing when the server already has rows", async () => {
    expect(await adoptPreOutboxSessions(USER, false, [session("local")])).toBe(0);
    expect(countPendingWrites(await readOutbox(USER))).toBe(0);
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
    expect(classifySyncError(new MeetCalApiError("x", 429, ""))).toBe("retry");
    expect(classifySyncError(new MeetCalApiError("x", 503, ""))).toBe("retry");
    expect(classifySyncError(new Error("network"))).toBe("retry");
  });
});

describe("tokenBelongsTo", () => {
  it("matches only the token's own subject and rejects unreadable tokens", () => {
    expect(tokenBelongsTo(jwtFor(USER), USER)).toBe(true);
    expect(tokenBelongsTo(jwtFor("user_2"), USER)).toBe(false);
    expect(tokenBelongsTo("token", USER)).toBe(false);
    expect(tokenBelongsTo("a.!!!.c", USER)).toBe(false);
    expect(tokenBelongsTo(`x.${Buffer.from("not json").toString("base64url")}.y`, USER)).toBe(false);
  });
});

describe("flushOutbox", () => {
  it("sends every entry in rev order and clears each on 2xx", async () => {
    await markSessionPut(USER, session("put-me"));
    await markResetPending(USER, OTHER);
    await markSessionDelete(USER, "delete-me", "Test Meet");

    const result = await flushOutbox(USER, getToken);

    expect(result.delivered).toBe(3);
    expect(result.remaining).toBe(0);
    const order = [
      mockPut.mock.invocationCallOrder[0],
      mockDeleteAll.mock.invocationCallOrder[0],
      mockDelete.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(mockDeleteAll).toHaveBeenCalledWith(TOKEN, OTHER);
  });

  it("holds later writes for a meet whose reset failed, so the reset cannot delete them", async () => {
    await markResetPending(USER, "Test Meet");
    await markSessionPut(USER, session("saved-after"));
    await markSessionPut(USER, session("other-meet", { meet: OTHER as never }));
    mockDeleteAll.mockRejectedValueOnce(new MeetCalApiError("down", 503, ""));

    const result = await flushOutbox(USER, getToken);

    // The other meet is independent and goes through; the held PUT waits.
    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(mockPut).toHaveBeenCalledWith(TOKEN, "other-meet", expect.anything());
    expect(result.remaining).toBe(2);

    // Next flush: reset first, then the PUT, which therefore survives.
    await flushOutbox(USER, getToken);
    expect(mockDeleteAll.mock.invocationCallOrder[1]).toBeLessThan(
      mockPut.mock.invocationCallOrder[1],
    );
    expect(countPendingWrites(await readOutbox(USER))).toBe(0);
  });

  it("sends the latest body when the session is edited while a flush is running", async () => {
    await markSessionPut(USER, session("first"));
    await markSessionPut(USER, session("edited", { notes: "v1" }));
    let releaseFirst: () => void = () => {};
    mockPut.mockImplementationOnce(
      () => new Promise((resolve) => {
        releaseFirst = () => resolve({ session_id: "first", updated_at: 1 });
      }),
    );

    const flushing = flushOutbox(USER, getToken);
    await new Promise((r) => setTimeout(r, 0));
    await markSessionPut(USER, session("edited", { notes: "v2" }));
    releaseFirst();
    await flushing;

    const editedCalls = mockPut.mock.calls.filter(([, id]) => id === "edited");
    expect(editedCalls).toHaveLength(1);
    expect(editedCalls[0][2]).toEqual(expect.objectContaining({ notes: "v2" }));
    expect(countPendingWrites(await readOutbox(USER))).toBe(0);
  });

  it("never sends a stale DELETE for a session re-saved during the flush", async () => {
    await markSessionPut(USER, session("slow"));
    await markSessionDelete(USER, "resaved", "Test Meet");
    let release: () => void = () => {};
    mockPut.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = () => resolve({ session_id: "slow", updated_at: 1 });
      }),
    );

    const flushing = flushOutbox(USER, getToken);
    await new Promise((r) => setTimeout(r, 0));
    await markSessionPut(USER, session("resaved"));
    // A save during the flush joins it rather than racing it.
    const joined = flushOutbox(USER, getToken);
    release();
    await Promise.all([flushing, joined]);

    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockPut).toHaveBeenCalledWith(TOKEN, "resaved", expect.anything());
  });

  it("keeps an entry the network could not deliver and stops", async () => {
    await markSessionPut(USER, session("a"));
    await markSessionPut(USER, session("b"));
    mockPut.mockRejectedValueOnce(new Error("offline"));

    const result = await flushOutbox(USER, getToken);

    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(result.remaining).toBe(2);
  });

  it("drops and reports an entry the server refused with 400", async () => {
    const rev = await markSessionPut(USER, session("bad"));
    mockPut.mockRejectedValueOnce(new MeetCalApiError("bad", 400, ""));

    const result = await flushOutbox(USER, getToken);

    expect(result.rejected.get("bad")).toBe(rev);
    expect(countPendingWrites(await readOutbox(USER))).toBe(0);
  });

  it("stops at the first 401 and keeps everything", async () => {
    await markSessionPut(USER, session("a"));
    await markSessionPut(USER, session("b"));
    mockPut.mockRejectedValueOnce(new MeetCalApiError("expired", 401, ""));

    const result = await flushOutbox(USER, getToken);

    expect(result.authExpired).toBe(true);
    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(countPendingWrites(await readOutbox(USER))).toBe(2);
  });

  it("says in a dev build which token claims a 401 rejected", async () => {
    await markSessionPut(USER, session("a"));
    mockPut.mockRejectedValueOnce(new MeetCalApiError("expired", 401, ""));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    await flushOutbox(USER, getToken);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("API rejected the sign-in token (401)"),
      expect.objectContaining({ iss: undefined, azp: undefined, aud: undefined }),
    );
    warn.mockRestore();
  });

  it("sends nothing when the token is for a different user (account switched mid-flush)", async () => {
    await markSessionPut(USER, session("a", { meet: OTHER as never }));
    await markResetPending(USER, "Test Meet");

    const result = await flushOutbox(USER, async () => jwtFor("someone_else"));

    expect(mockPut).not.toHaveBeenCalled();
    expect(mockDeleteAll).not.toHaveBeenCalled();
    expect(result.remaining).toBe(2);
  });

  it("re-checks the token before every send, not once per flush", async () => {
    await markSessionPut(USER, session("a"));
    await markSessionPut(USER, session("b"));
    const tokens = [TOKEN, jwtFor("someone_else")];
    const result = await flushOutbox(USER, async () => tokens.shift() ?? null);

    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(result.remaining).toBe(1);
  });

  it("sends nothing without a token", async () => {
    await markSessionPut(USER, session("a"));
    const result = await flushOutbox(USER, async () => null);
    expect(mockPut).not.toHaveBeenCalled();
    expect(result.remaining).toBe(1);
  });

  it("treats a 404 on delete as done", async () => {
    await markSessionDelete(USER, "already-gone", "Test Meet");
    mockDelete.mockRejectedValueOnce(new MeetCalApiError("missing", 404, ""));

    const result = await flushOutbox(USER, getToken);

    expect(result.remaining).toBe(0);
    expect(result.rejected.size).toBe(0);
  });
});
