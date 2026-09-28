/**
 * The outbox against the real API client, with only the transport stubbed.
 *
 * `saved-sessions-outbox.test.ts` mocks the API module (and its error
 * classes) to exercise ordering and bookkeeping. These cases keep
 * `lib/api/meetcal-api.ts` in the path, so what is asserted is the Convex
 * call the backend actually receives and how real rejections and answers are
 * classified. Shapes and argument validators follow `convex/users.ts`, which
 * answers what meetcal-backend `app/src/routes/users/saved_sessions.rs` did.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { resetServerClockForTests } from "@/lib/api/meetcal-api";
import { isClockCall } from "@/lib/api/json-transport-stub";
import { setApiTransportForTests, TransportRequestError, type ApiCall } from "@/lib/api/transport";
import type { SavedSession } from "@/lib/saved-sessions-store";
import {
  countPendingWrites,
  flushOutbox,
  markResetPending,
  markSessionDelete,
  markSessionPut,
  readOutbox,
} from "@/lib/saved-sessions-outbox";

const USER = "user_1";

function jwtFor(sub: string): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part({ sub })}.sig`;
}
const TOKEN = jwtFor(USER);

/**
 * `users:putSavedSession`'s argument validator besides `sessionId`. Convex
 * rejects a call carrying any other key, and a `null` where the validator
 * says `v.optional(...)`.
 */
const PUT_ARG_TYPES: Record<string, "string" | "number" | "string[]"> = {
  meet: "string",
  session_number: "number",
  platform: "string",
  weight_class: "string",
  start_time: "string",
  date: "string",
  notes: "string",
  athlete_names: "string[]",
};

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

/** What a Convex function's `ConvexError({ status, error })` reaches the client as. */
function rejection(status: number, data: Record<string, unknown>): TransportRequestError {
  return new TransportRequestError(
    `mutation failed with ${status}`,
    status,
    JSON.stringify({ status, ...data }),
  );
}

let sent: ApiCall[] = [];
let respond: (call: ApiCall) => unknown = () => {
  throw rejection(500, { error: "unconfigured" });
};
let transport: jest.Mock<Promise<unknown>, [ApiCall]>;

beforeEach(async () => {
  sent = [];
  resetServerClockForTests();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  // The `__DEV__` slow-request log fires on the timeout case.
  jest.spyOn(console, "info").mockImplementation(() => {});
  await AsyncStorage.clear();
  transport = jest.fn(async (call: ApiCall): Promise<unknown> => {
    // The client samples the server clock alongside its first call.
    if (isClockCall(call)) return Date.now();
    sent.push(call);
    return respond(call);
  });
  setApiTransportForTests(transport);
});

afterEach(() => {
  setApiTransportForTests(null);
  resetServerClockForTests();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** The backend's success answer for each write. */
function backendOk(call: ApiCall): unknown {
  switch (call.fn) {
    case "users:putSavedSession":
      return { session_id: call.args.sessionId, updated_at: 1717171717000 };
    case "users:deleteSavedSession":
      return { deleted: true };
    case "users:deleteSavedSessions":
      return { deleted_count: 2 };
    default:
      throw new Error(`unexpected call to ${call.fn}`);
  }
}

describe("outbox replay over the real API client", () => {
  it("sends a reset, a delete and a put in rev order with the owner's token", async () => {
    await markResetPending(USER, "Other Meet");
    await markSessionDelete(USER, "Test Meet-2-Red", "Test Meet");
    await markSessionPut(
      USER,
      session("Test Meet/Finals-1-Red", { notes: "bring chalk", athleteNames: ["Athlete A"] }),
    );
    respond = backendOk;

    const result = await flushOutbox(USER, async () => TOKEN);

    expect(sent.map((call) => [call.kind, call.fn])).toEqual([
      ["mutation", "users:deleteSavedSessions"],
      ["mutation", "users:deleteSavedSession"],
      ["mutation", "users:putSavedSession"],
    ]);
    expect(sent[0].args).toEqual({ meet: "Other Meet" });
    expect(sent[1].args).toEqual({ sessionId: "Test Meet-2-Red" });
    // A `/` in the meet name is part of the id argument, not a path segment.
    expect(sent[2].args.sessionId).toBe("Test Meet/Finals-1-Red");
    expect(sent.every((call) => call.token === TOKEN)).toBe(true);

    const { sessionId: _id, ...putArgs } = sent[2].args;
    const violations = Object.entries(putArgs)
      // An undefined member is dropped before it reaches Convex.
      .filter(([, value]) => value !== undefined)
      .filter(([key, value]) => {
        const type = PUT_ARG_TYPES[key];
        if (type === "string[]") {
          return !(Array.isArray(value) && value.every((name) => typeof name === "string"));
        }
        return typeof value !== type;
      })
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
    expect(violations).toEqual([]);
    expect(putArgs).toMatchObject({
      meet: "Test Meet",
      session_number: 1,
      platform: "Red",
      date: "2099-06-20",
      notes: "bring chalk",
      athlete_names: ["Athlete A"],
    });

    expect(result).toMatchObject({ delivered: 3, remaining: 0, authExpired: false });
    expect(countPendingWrites(await readOutbox(USER))).toBe(0);
  });

  it("keeps every write queued and sends nothing when Clerk getToken() throws", async () => {
    await markSessionPut(USER, session("a"));
    await markSessionDelete(USER, "b", "Test Meet");
    respond = backendOk;

    const result = await flushOutbox(USER, async () => {
      throw new Error("clerk: network request failed");
    });

    expect(sent).toEqual([]);
    // Not even the clock sample: nothing reached the backend.
    expect(transport).not.toHaveBeenCalled();
    expect(result).toMatchObject({ delivered: 0, remaining: 2, authExpired: false });
    expect(Object.keys((await readOutbox(USER)).sessions).sort()).toEqual(["a", "b"]);
  });

  it("flags an expired session on 401 and keeps the write", async () => {
    await markSessionPut(USER, session("a"));
    respond = () => {
      throw rejection(401, { error: "unauthorized" });
    };

    const result = await flushOutbox(USER, async () => TOKEN);

    expect(result.authExpired).toBe(true);
    expect((await readOutbox(USER)).sessions.a).toMatchObject({ op: "put" });
  });

  it("retries after a dropped connection instead of dropping the write as a refusal", async () => {
    // Anything other than a status-carrying rejection means the backend was
    // not reached; the write must stay queued.
    await markSessionPut(USER, session("a"));
    respond = () => {
      throw new Error("Connection lost while action was in flight");
    };

    const result = await flushOutbox(USER, async () => TOKEN);

    expect(result.rejected.size).toBe(0);
    expect(result.remaining).toBe(1);
    expect((await readOutbox(USER)).sessions.a).toMatchObject({ op: "put" });
  });

  it("retries after the client's own timeout instead of dropping it", async () => {
    jest.useFakeTimers();
    await markSessionPut(USER, session("a"));
    respond = () => new Promise(() => {});

    const flushing = flushOutbox(USER, async () => TOKEN);
    // The default per-call timeout (`DEFAULT_TIMEOUT_MS`).
    await jest.advanceTimersByTimeAsync(10_000);
    const result = await flushing;

    expect(sent.map((call) => call.fn)).toEqual(["users:putSavedSession"]);
    expect(result.rejected.size).toBe(0);
    expect(result.remaining).toBe(1);
    expect((await readOutbox(USER)).sessions.a).toMatchObject({ op: "put" });
  });

  it("drops a PUT the server refuses with 400 and reports its rev", async () => {
    const rev = await markSessionPut(USER, session("a", { notes: "x".repeat(5000) }));
    respond = () => {
      throw rejection(400, { error: "notes too long", max: 2000 });
    };

    const result = await flushOutbox(USER, async () => TOKEN);

    expect(result.rejected.get("a")).toBe(rev);
    expect(countPendingWrites(await readOutbox(USER))).toBe(0);
  });

  it("treats a 404 on a single delete as already done", async () => {
    await markSessionDelete(USER, "gone", "Test Meet");
    respond = () => {
      throw rejection(404, { error: "not found" });
    };

    const result = await flushOutbox(USER, async () => TOKEN);

    expect(sent.map((call) => [call.fn, call.args])).toEqual([
      ["users:deleteSavedSession", { sessionId: "gone" }],
    ]);
    expect(result).toMatchObject({ delivered: 1, remaining: 0 });
  });

  it("keeps a delete queued when the acknowledgement is not the backend's shape", async () => {
    await markSessionDelete(USER, "a", "Test Meet");
    await markResetPending(USER, "Other Meet");
    respond = () => ({});

    const result = await flushOutbox(USER, async () => TOKEN);

    expect(result.delivered).toBe(0);
    expect(result.rejected.size).toBe(0);
    const outbox = await readOutbox(USER);
    expect(outbox.sessions.a).toMatchObject({ op: "delete" });
    expect(outbox.resets["Other Meet"]).toBeDefined();
  });
});
