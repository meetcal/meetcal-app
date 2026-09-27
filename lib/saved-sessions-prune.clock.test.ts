// The prune against the real API client (not a mocked clock): the server
// clock sample it needs must be taken for it, however long ago the process's
// first request sampled the clock.
import { getMeetConfig } from "@/data/meets/config";
import { fetchApiMeets, resetServerClockForTests } from "@/lib/api/meetcal-api";
import { setApiTransportForTests, type ApiCall } from "@/lib/api/transport";
import { pruneStartedSessions } from "@/lib/saved-sessions-prune";
import type { SavedSession } from "@/lib/saved-sessions-store";

jest.mock("@/data/meets/config", () => ({
  getMeetConfig: jest.fn(),
  convertToUTC: jest.fn((time: string) => new Date(time)),
}));

function jwtFor(sub: string): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part({ sub })}.sig`;
}

const expired: SavedSession = {
  id: "old",
  meet: "Meet A" as never,
  sessionNumber: 1,
  platform: "Red",
  weightClass: "",
  startTime: "2000-01-01T00:00:00.000Z",
  weighInTime: "",
  date: "2000-01-01",
};

describe("pruneStartedSessions with the real server clock", () => {
  const calls: string[] = [];

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2099-06-20T12:00:00.000Z") });
    resetServerClockForTests();
    calls.length = 0;
    (getMeetConfig as jest.Mock).mockResolvedValue({ time: { timeZoneIdentifier: "America/New_York" } });
    setApiTransportForTests(async (call: ApiCall) => {
      calls.push(call.fn);
      if (call.fn === "system:serverTime") return Date.now();
      if (call.fn === "users:preferences") return { auto_unsave_started_sessions: true };
      if (call.fn === "meets:list") return { etag: '"m"', json: "[]" };
      throw new Error(`unexpected ${call.fn}`);
    });
  });

  afterEach(() => {
    setApiTransportForTests(null);
    jest.useRealTimers();
  });

  it("samples the clock for the prune even when an earlier request already did", async () => {
    await fetchApiMeets(); // the process's first request samples the clock
    jest.setSystemTime(Date.now() + 60_000); // a minute later: the sample is not stale
    const removeSession = jest.fn(async () => true);
    await pruneStartedSessions({
      clerkUserId: "user_1",
      isActive: () => true,
      getToken: async () => jwtFor("user_1"),
      readStoredSessions: async () => [expired],
      removeSession,
    });
    expect(removeSession).toHaveBeenCalledWith("old");
    expect(calls.filter((fn) => fn === "system:serverTime")).toHaveLength(2);
  });
});
