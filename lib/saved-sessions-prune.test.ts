import { convertToUTC, getMeetConfig } from "@/data/meets/config";
import { fetchUserPreferences } from "@/lib/api/meetcal-api";
import { findExpiredSessionIds, pruneStartedSessions } from "@/lib/saved-sessions-prune";
import type { SavedSession } from "@/lib/saved-sessions-store";

jest.mock("@/data/meets/config", () => ({
  getMeetConfig: jest.fn(),
  // `startTime` is an ISO instant in these fixtures.
  convertToUTC: jest.fn((time: string) => {
    if (time === "bad") throw new Error("bad time");
    return new Date(time);
  }),
}));

// The preferences request is also the server clock sample the prune needs;
// by default the server agrees with the device and the sample is fresh.
let mockServerClock: () => { skewMs: number; sampledAt: number } | null = () => ({
  skewMs: 0,
  sampledAt: Date.now(),
});
jest.mock("@/lib/api/meetcal-api", () => ({
  fetchUserPreferences: jest.fn(async () => ({ auto_unsave_started_sessions: true })),
  getServerClockSample: () => mockServerClock(),
  MAX_PLAUSIBLE_CLOCK_SKEW_MS: 15 * 60 * 1000,
}));

const mockGetMeetConfig = getMeetConfig as jest.MockedFunction<typeof getMeetConfig>;
const mockConvertToUTC = convertToUTC as jest.MockedFunction<typeof convertToUTC>;
const mockFetchUserPreferences = fetchUserPreferences as jest.MockedFunction<
  typeof fetchUserPreferences
>;

const NOW = new Date("2099-06-20T12:00:00.000Z");

const session = (id: string, startTime: string, meet = "Meet A"): SavedSession => ({
  id,
  meet: meet as never,
  sessionNumber: 1,
  platform: "Red",
  weightClass: "",
  startTime,
  weighInTime: "",
  date: "2099-06-20",
});

function jwtFor(sub: string): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part({ sub })}.sig`;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockServerClock = () => ({ skewMs: 0, sampledAt: Date.now() });
  mockGetMeetConfig.mockResolvedValue({
    time: { timeZoneIdentifier: "America/New_York" },
  } as never);
});

describe("findExpiredSessionIds", () => {
  it("returns sessions at least two hours past their start", async () => {
    const ids = await findExpiredSessionIds(
      [
        session("old", "2099-06-20T09:00:00.000Z"),
        session("edge", "2099-06-20T10:00:00.000Z"),
        session("recent", "2099-06-20T11:00:00.000Z"),
      ],
      NOW,
    );
    expect(ids).toEqual(["old", "edge"]);
  });

  it("keeps rows with no time or date, or a time that does not convert", async () => {
    const ids = await findExpiredSessionIds(
      [session("no-time", ""), { ...session("no-date", "2000-01-01T00:00:00.000Z"), date: "" }, session("bad", "bad")],
      NOW,
    );
    expect(ids).toEqual([]);
  });

  it("keeps a session whose stored date does not exist instead of rolling it into the past", async () => {
    // Real conversion: month 00 used to normalise to the previous December,
    // which is "already started", so auto-unsave deleted the session.
    const actual = jest.requireActual("@/data/meets/config") as typeof import("@/data/meets/config");
    mockConvertToUTC.mockImplementation(actual.convertToUTC);
    try {
      const ids = await findExpiredSessionIds(
        [
          { ...session("impossible", "10:00 AM"), date: "2099-00-10" },
          { ...session("past", "10:00 AM"), date: "2099-06-19" },
        ],
        NOW,
      );
      expect(ids).toEqual(["past"]);
    } finally {
      mockConvertToUTC.mockImplementation((time: string) => {
        if (time === "bad") throw new Error("bad time");
        return new Date(time);
      });
    }
  });

  it("looks each meet's time zone up once and keeps a meet's rows when its zone cannot be resolved", async () => {
    // Meet A's lookup fails (not in the cached list, /meets/details down).
    // Reading its wall-clock times as UTC would expire them early; they must
    // be kept instead. Meet B resolves and its expired row is still pruned.
    mockGetMeetConfig.mockRejectedValueOnce(new Error("offline"));
    const ids = await findExpiredSessionIds(
      [
        session("a1", "2000-01-01T00:00:00.000Z", "Meet A"),
        session("a2", "2000-01-01T00:00:00.000Z", "Meet A"),
        session("b1", "2000-01-01T00:00:00.000Z", "Meet B"),
      ],
      NOW,
    );
    expect(ids).toEqual(["b1"]);
    expect(mockGetMeetConfig).toHaveBeenCalledTimes(2);
    expect(mockConvertToUTC.mock.calls.map(([, , zone]) => zone)).toEqual([
      "America/New_York",
    ]);
  });

  it("keeps a meet's rows when its config has no time zone", async () => {
    mockGetMeetConfig.mockResolvedValueOnce({ time: { timeZoneIdentifier: "" } } as never);
    const ids = await findExpiredSessionIds(
      [session("a1", "2000-01-01T00:00:00.000Z", "Meet A")],
      NOW,
    );
    expect(ids).toEqual([]);
    expect(mockConvertToUTC).not.toHaveBeenCalled();
  });
});

describe("pruneStartedSessions", () => {
  const expired = session("old", "2000-01-01T00:00:00.000Z");

  function deps(overrides: Partial<Parameters<typeof pruneStartedSessions>[0]> = {}) {
    return {
      clerkUserId: "user_1",
      isActive: (userId: string) => userId === "user_1",
      getToken: async () => jwtFor("user_1"),
      readStoredSessions: async () => [expired],
      removeSession: jest.fn(async () => true),
      ...overrides,
    };
  }

  it("removes expired sessions when the preference is on", async () => {
    const d = deps();
    await pruneStartedSessions(d);
    expect(d.removeSession).toHaveBeenCalledWith("old");
  });

  it("does nothing when the preference is off", async () => {
    mockFetchUserPreferences.mockResolvedValueOnce({ auto_unsave_started_sessions: false } as never);
    const d = deps();
    await pruneStartedSessions(d);
    expect(d.removeSession).not.toHaveBeenCalled();
  });

  it("does nothing without a verified user or with another user's token", async () => {
    const noUser = deps({ clerkUserId: null });
    await pruneStartedSessions(noUser);
    const otherToken = deps({ getToken: async () => jwtFor("user_2") });
    await pruneStartedSessions(otherToken);
    expect(mockFetchUserPreferences).not.toHaveBeenCalled();
    expect(noUser.removeSession).not.toHaveBeenCalled();
    expect(otherToken.removeSession).not.toHaveBeenCalled();
  });

  it("skips pruning when Clerk throws", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({ getToken: async () => { throw new Error("clerk"); } });
    await pruneStartedSessions(d);
    expect(d.removeSession).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  describe("on the server's clock", () => {
    const HOUR_MS = 60 * 60 * 1000;
    // Started 90 minutes ago by the server's clock: not yet past the window.
    const recent = (serverNow: number) => session("recent", new Date(serverNow - 90 * 60 * 1000).toISOString());

    afterEach(() => {
      jest.useRealTimers();
    });

    it("removes nothing when the device clock runs three hours ahead of the server", async () => {
      jest.useFakeTimers();
      const serverNow = Date.parse("2099-06-20T12:00:00.000Z");
      jest.setSystemTime(serverNow + 3 * HOUR_MS);
      // The Date header says real time; the device is three hours fast.
      mockServerClock = () => ({ skewMs: -3 * HOUR_MS, sampledAt: Date.now() });
      const d = deps({ readStoredSessions: async () => [recent(serverNow), expired] });

      await pruneStartedSessions(d);

      // Neither the session that "started" 4.5 h ago by the device nor the
      // genuinely old one: a clock that far off is not trusted to delete.
      expect(d.removeSession).not.toHaveBeenCalled();
    });

    it("removes started sessions when the Date header matches the device", async () => {
      jest.useFakeTimers();
      const serverNow = Date.parse("2099-06-20T12:00:00.000Z");
      jest.setSystemTime(serverNow);
      mockServerClock = () => ({ skewMs: 0, sampledAt: Date.now() });
      const d = deps({ readStoredSessions: async () => [recent(serverNow), expired] });

      await pruneStartedSessions(d);

      expect(d.removeSession).toHaveBeenCalledTimes(1);
      expect(d.removeSession).toHaveBeenCalledWith("old");
    });

    it("judges the window on the corrected clock for a small skew", async () => {
      jest.useFakeTimers();
      const serverNow = Date.parse("2099-06-20T12:00:00.000Z");
      // Device 10 minutes fast: by its clock `edge` started 2h05m ago, by
      // the server's 1h55m.
      jest.setSystemTime(serverNow + 10 * 60 * 1000);
      mockServerClock = () => ({ skewMs: -10 * 60 * 1000, sampledAt: Date.now() });
      const edge = session("edge", new Date(serverNow - 115 * 60 * 1000).toISOString());
      const d = deps({ readStoredSessions: async () => [edge, expired] });

      await pruneStartedSessions(d);

      expect(d.removeSession).toHaveBeenCalledTimes(1);
      expect(d.removeSession).toHaveBeenCalledWith("old");
    });

    it("skips without a server clock sample, or with a stale one", async () => {
      mockServerClock = () => null;
      const none = deps();
      await pruneStartedSessions(none);
      expect(none.removeSession).not.toHaveBeenCalled();

      // A sample from before this prune's own request is not this request's.
      mockServerClock = () => ({ skewMs: 0, sampledAt: Date.now() - 60_000 });
      const stale = deps();
      await pruneStartedSessions(stale);
      expect(stale.removeSession).not.toHaveBeenCalled();
    });
  });

  it("stops once the user is no longer active", async () => {
    let active = true;
    const d = deps({
      isActive: () => active,
      readStoredSessions: async () => {
        active = false;
        return [expired];
      },
    });
    await pruneStartedSessions(d);
    expect(d.removeSession).not.toHaveBeenCalled();
  });
});
