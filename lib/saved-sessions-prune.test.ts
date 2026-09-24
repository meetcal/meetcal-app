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

jest.mock("@/lib/api/meetcal-api", () => ({
  fetchUserPreferences: jest.fn(async () => ({ auto_unsave_started_sessions: true })),
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

  it("looks each meet's time zone up once, falling back to UTC", async () => {
    mockGetMeetConfig.mockRejectedValueOnce(new Error("offline"));
    await findExpiredSessionIds(
      [
        session("a1", "2000-01-01T00:00:00.000Z", "Meet A"),
        session("a2", "2000-01-01T00:00:00.000Z", "Meet A"),
        session("b1", "2000-01-01T00:00:00.000Z", "Meet B"),
      ],
      NOW,
    );
    expect(mockGetMeetConfig).toHaveBeenCalledTimes(2);
    expect(mockConvertToUTC.mock.calls.map(([, , zone]) => zone)).toEqual([
      "UTC",
      "UTC",
      "America/New_York",
    ]);
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
