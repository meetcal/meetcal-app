/**
 * The outbox against the real API client, with only `fetch` stubbed.
 *
 * `saved-sessions-outbox.test.ts` mocks the API module (and its error
 * classes) to exercise ordering and bookkeeping. These cases keep
 * `lib/api/meetcal-api.ts` in the path, so what is asserted is the request
 * the server actually receives and how real status codes and bodies are
 * classified. Shapes follow meetcal-backend
 * `app/src/routes/users/saved_sessions.rs`.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SavedSession } from "@/lib/saved-sessions-store";
import {
  countPendingWrites,
  flushOutbox,
  markResetPending,
  markSessionDelete,
  markSessionPut,
  readOutbox,
} from "@/lib/saved-sessions-outbox";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { version: "6.2.0" } },
}));
jest.mock("expo-application", () => ({
  __esModule: true,
  nativeApplicationVersion: "6.2.0",
}));

const USER = "user_1";

function jwtFor(sub: string): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part({ sub })}.sig`;
}
const TOKEN = jwtFor(USER);

/** `SavedSessionRequest` in the backend; anything else is ignored or rejected there. */
const BACKEND_PUT_FIELDS = [
  "meet",
  "session_number",
  "platform",
  "weight_class",
  "start_time",
  "date",
  "notes",
  "athlete_names",
];

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

type Reply = { status: number; body: string };
type Sent = { method: string; url: string; auth: string | undefined; body: unknown };

let sent: Sent[] = [];
let respond: (request: Sent) => Reply = () => ({ status: 500, body: "" });

const originalFetch = global.fetch;

beforeEach(async () => {
  sent = [];
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  await AsyncStorage.clear();
  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    const request: Sent = {
      method: init.method ?? "GET",
      url,
      auth: headers.Authorization,
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    };
    sent.push(request);
    const reply = respond(request);
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      headers: { get: () => null },
      text: async () => reply.body,
    };
  }) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

/** The backend's success body for each write route. */
function backendOk(request: Sent): Reply {
  if (request.method === "PUT") {
    const id = decodeURIComponent(request.url.split("/saved-sessions/")[1]);
    return { status: 200, body: JSON.stringify({ session_id: id, updated_at: 1717171717000 }) };
  }
  if (request.method === "DELETE" && request.url.includes("/saved-sessions/")) {
    return { status: 200, body: JSON.stringify({ deleted: true }) };
  }
  return { status: 200, body: JSON.stringify({ deleted_count: 2 }) };
}

describe("outbox replay over the real API client", () => {
  it("sends a reset, a delete and a put in rev order with the owner's bearer token", async () => {
    await markResetPending(USER, "Other Meet");
    await markSessionDelete(USER, "Test Meet-2-Red", "Test Meet");
    await markSessionPut(
      USER,
      session("Test Meet/Finals-1-Red", { notes: "bring chalk", athleteNames: ["Athlete A"] }),
    );
    respond = backendOk;

    const result = await flushOutbox(USER, async () => TOKEN);

    expect(sent.map((r) => `${r.method} ${r.url.replace("https://api.meetcal.app", "")}`)).toEqual([
      "DELETE /users/me/saved-sessions?meet=Other+Meet",
      "DELETE /users/me/saved-sessions/Test%20Meet-2-Red",
      "PUT /users/me/saved-sessions/Test%20Meet%2FFinals-1-Red",
    ]);
    expect(sent.every((r) => r.auth === `Bearer ${TOKEN}`)).toBe(true);

    const putBody = sent[2].body as Record<string, unknown>;
    expect(Object.keys(putBody).every((key) => BACKEND_PUT_FIELDS.includes(key))).toBe(true);
    expect(putBody).toMatchObject({
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
    expect(result).toMatchObject({ delivered: 0, remaining: 2, authExpired: false });
    expect(Object.keys((await readOutbox(USER)).sessions).sort()).toEqual(["a", "b"]);
  });

  it("flags an expired session on 401 and keeps the write", async () => {
    await markSessionPut(USER, session("a"));
    respond = () => ({ status: 401, body: '{"error":"unauthorized"}' });

    const result = await flushOutbox(USER, async () => TOKEN);

    expect(result.authExpired).toBe(true);
    expect((await readOutbox(USER)).sessions.a).toMatchObject({ op: "put" });
  });

  it("retries after the server's own 408 timeout instead of dropping it as a 4xx refusal", async () => {
    // A 408 is in the 4xx range, and any other 4xx means "never send this
    // again". It only survives because the client turns it into a timeout.
    await markSessionPut(USER, session("a"));
    respond = () => ({ status: 408, body: '{"error":"timeout"}' });

    const result = await flushOutbox(USER, async () => TOKEN);

    expect(result.rejected.size).toBe(0);
    expect(result.remaining).toBe(1);
    expect((await readOutbox(USER)).sessions.a).toMatchObject({ op: "put" });
  });

  it("drops a PUT the server refuses with 400 and reports its rev", async () => {
    const rev = await markSessionPut(USER, session("a", { notes: "x".repeat(5000) }));
    respond = () => ({ status: 400, body: '{"error":"notes too long","max":2000}' });

    const result = await flushOutbox(USER, async () => TOKEN);

    expect(result.rejected.get("a")).toBe(rev);
    expect(countPendingWrites(await readOutbox(USER))).toBe(0);
  });

  it("treats a 404 on a single delete as already done", async () => {
    await markSessionDelete(USER, "gone", "Test Meet");
    respond = () => ({ status: 404, body: '{"error":"not found"}' });

    const result = await flushOutbox(USER, async () => TOKEN);

    expect(result).toMatchObject({ delivered: 1, remaining: 0 });
  });

  it("keeps a delete queued when the 200 acknowledgement is not the backend's shape", async () => {
    await markSessionDelete(USER, "a", "Test Meet");
    await markResetPending(USER, "Other Meet");
    respond = () => ({ status: 200, body: "{}" });

    const result = await flushOutbox(USER, async () => TOKEN);

    expect(result.delivered).toBe(0);
    expect(result.rejected.size).toBe(0);
    const outbox = await readOutbox(USER);
    expect(outbox.sessions.a).toMatchObject({ op: "delete" });
    expect(outbox.resets["Other Meet"]).toBeDefined();
  });
});
