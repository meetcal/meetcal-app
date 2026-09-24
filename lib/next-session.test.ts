import { SavedSession } from "@/hooks/useSavedSessions";
import { selectNextSession, STARTED_GRACE_MS } from "@/lib/next-session";
import { Meet } from "@/data/types/meet";

const MEET_NAME = "Test Meet";

function makeMeet(overrides: Partial<Meet> = {}): Meet {
  return {
    id: "1",
    name: MEET_NAME,
    venue: {
      name: "Venue",
      address: { street: "1 St", city: "City", state: "ST", zip: "00000" },
    },
    time: {
      timeZone: "Eastern",
      timeZoneIdentifier: "America/New_York",
      abbreviation: "EDT",
      utcOffset: 4,
    },
    dates: { start: "2026-07-16", end: "2026-07-16" },
    status: "ongoing",
    ...overrides,
  };
}

function makeSession(overrides: Partial<SavedSession> = {}): SavedSession {
  return {
    id: "s1",
    meet: MEET_NAME,
    sessionNumber: 1,
    platform: "Red",
    weightClass: "89kg",
    startTime: "3:00 PM",
    weighInTime: "1:00 PM",
    date: "2026-07-16",
    ...overrides,
  };
}

describe("selectNextSession", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns null when the meet is not today/ongoing", () => {
    // now is 2026-07-16, but the meet ran earlier and status is upcoming.
    const meet = makeMeet({
      status: "upcoming",
      dates: { start: "2026-07-01", end: "2026-07-02" },
    });
    const sessions = [makeSession()];
    const now = new Date("2026-07-16T18:00:00Z");
    jest.useFakeTimers();
    jest.setSystemTime(now);
    expect(selectNextSession(sessions, MEET_NAME, meet, now)).toBeNull();
  });

  it("returns null when selectedMeet or meetDetails is missing", () => {
    const now = new Date("2026-07-16T18:00:00Z");
    expect(selectNextSession([makeSession()], null, makeMeet(), now)).toBeNull();
    expect(selectNextSession([makeSession()], MEET_NAME, null, now)).toBeNull();
  });

  it("picks the soonest upcoming session for an ongoing meet", () => {
    // now = 14:00 EDT. Two future sessions at 3pm and 5pm EDT.
    const now = new Date("2026-07-16T18:00:00Z");
    const early = makeSession({ id: "early", startTime: "3:00 PM" });
    const late = makeSession({ id: "late", startTime: "5:00 PM" });
    const result = selectNextSession([late, early], MEET_NAME, makeMeet(), now);
    expect(result?.session.id).toBe("early");
  });

  it("keeps a session that started 20 minutes ago (inside the grace window)", () => {
    // now = 14:00 EDT (18:00 UTC). 1:40 PM EDT started 20 min ago.
    const now = new Date("2026-07-16T18:00:00Z");
    const session = makeSession({ id: "recent", startTime: "1:40 PM" });
    const result = selectNextSession([session], MEET_NAME, makeMeet(), now);
    expect(result?.session.id).toBe("recent");
    expect(result?.startMs).toBe(new Date("2026-07-16T17:40:00Z").getTime());
  });

  it("skips a session that started 45 minutes ago (past the grace window)", () => {
    // now = 14:00 EDT. 1:15 PM EDT started 45 min ago.
    const now = new Date("2026-07-16T18:00:00Z");
    const session = makeSession({ id: "stale", startTime: "1:15 PM" });
    expect(selectNextSession([session], MEET_NAME, makeMeet(), now)).toBeNull();
  });

  it("skips sessions missing startTime or date and sessions for other meets", () => {
    const now = new Date("2026-07-16T18:00:00Z");
    const noStart = makeSession({ id: "noStart", startTime: "" });
    const noDate = makeSession({ id: "noDate", date: "" });
    const otherMeet = makeSession({ id: "other", meet: "Different Meet" });
    expect(
      selectNextSession([noStart, noDate, otherMeet], MEET_NAME, makeMeet(), now),
    ).toBeNull();
  });

  it("treats the meet as today using its timezone even when the UTC date differs (tz behind UTC)", () => {
    // now UTC = 2026-07-16 05:00, which is 2026-07-15 19:00 in Honolulu.
    const now = new Date("2026-07-16T05:00:00Z");
    // The "is meet today" check reads the wall clock (in the meet's timezone),
    // so pin the system clock to `now` to keep it deterministic.
    jest.useFakeTimers();
    jest.setSystemTime(now);
    const meet = makeMeet({
      status: "upcoming",
      time: {
        timeZone: "Hawaii",
        timeZoneIdentifier: "Pacific/Honolulu" as Meet["time"]["timeZoneIdentifier"],
        abbreviation: "HST",
        utcOffset: 10,
      },
      dates: { start: "2026-07-15", end: "2026-07-15" },
    });
    // Session at 8pm HST on the 15th = 2026-07-16 06:00 UTC, one hour ahead of now.
    const session = makeSession({
      id: "hst",
      date: "2026-07-15",
      startTime: "8:00 PM",
    });
    const result = selectNextSession([session], MEET_NAME, meet, now);
    expect(result?.session.id).toBe("hst");
    expect(result?.startMs).toBe(new Date("2026-07-16T06:00:00Z").getTime());
  });

  it("treats the meet as today using its timezone when the tz is ahead of UTC", () => {
    // now UTC = 2026-07-16 20:00, which is 2026-07-17 05:00 in Tokyo.
    const now = new Date("2026-07-16T20:00:00Z");
    jest.useFakeTimers();
    jest.setSystemTime(now);
    const meet = makeMeet({
      status: "upcoming",
      time: {
        timeZone: "Japan",
        timeZoneIdentifier: "Asia/Tokyo" as Meet["time"]["timeZoneIdentifier"],
        abbreviation: "JST",
        utcOffset: -9,
      },
      dates: { start: "2026-07-17", end: "2026-07-17" },
    });
    // 6am JST on the 17th = 2026-07-16 21:00 UTC, one hour ahead of now.
    const session = makeSession({
      id: "jst",
      date: "2026-07-17",
      startTime: "6:00 AM",
    });
    const result = selectNextSession([session], MEET_NAME, meet, now);
    expect(result?.session.id).toBe("jst");
    expect(result?.startMs).toBe(new Date("2026-07-16T21:00:00Z").getTime());
  });
});

describe("selectNextSession boundaries", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  const upcomingTwoDayMeet = () =>
    makeMeet({ status: "upcoming", dates: { start: "2026-07-15", end: "2026-07-16" } });

  it("decides 'is the meet today' from the `now` it is given, not the wall clock", () => {
    // Regression: the day check read `new Date()` while the start-time check
    // read `now`. Park the wall clock years away to prove it is not consulted.
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2031-01-01T12:00:00Z"));
    const now = new Date("2026-07-16T18:00:00Z"); // 2pm EDT on the last day
    const result = selectNextSession(
      [makeSession({ id: "today", startTime: "3:00 PM" })],
      MEET_NAME,
      upcomingTwoDayMeet(),
      now,
    );
    expect(result?.session.id).toBe("today");

    // And the other way round: the wall clock inside the meet does not make
    // a `now` after the meet count as today.
    jest.setSystemTime(now);
    expect(
      selectNextSession(
        [makeSession({ date: "2026-07-17", startTime: "3:00 PM" })],
        MEET_NAME,
        upcomingTwoDayMeet(),
        new Date("2026-07-17T18:00:00Z"),
      ),
    ).toBeNull();
  });

  it("reads the meet's first and last day at the meet-zone midnight", () => {
    const meet = upcomingTwoDayMeet();
    const lateSession = makeSession({ date: "2026-07-17", startTime: "11:00 AM" });
    const firstDaySession = makeSession({ date: "2026-07-15", startTime: "11:00 AM" });
    // 23:59 EDT on the last day is still the meet (UTC already reads the 17th).
    expect(
      selectNextSession([lateSession], MEET_NAME, meet, new Date("2026-07-17T03:59:00Z")),
    ).not.toBeNull();
    // Midnight EDT after the last day is not.
    expect(
      selectNextSession([lateSession], MEET_NAME, meet, new Date("2026-07-17T04:00:00Z")),
    ).toBeNull();
    // 00:00 EDT on the first day is the meet; 23:59 EDT the day before is not.
    expect(
      selectNextSession([firstDaySession], MEET_NAME, meet, new Date("2026-07-15T04:00:00Z")),
    ).not.toBeNull();
    expect(
      selectNextSession([firstDaySession], MEET_NAME, meet, new Date("2026-07-15T03:59:00Z")),
    ).toBeNull();
  });

  it("drops a session exactly at the end of the grace window and keeps it 1 ms before", () => {
    const start = new Date("2026-07-16T17:40:00Z"); // 1:40 PM EDT
    const session = makeSession({ id: "edge", startTime: "1:40 PM" });
    expect(
      selectNextSession(
        [session],
        MEET_NAME,
        makeMeet(),
        new Date(start.getTime() + STARTED_GRACE_MS),
      ),
    ).toBeNull();
    expect(
      selectNextSession(
        [session],
        MEET_NAME,
        makeMeet(),
        new Date(start.getTime() + STARTED_GRACE_MS - 1),
      )?.session.id,
    ).toBe("edge");
  });

  it("breaks a start-time tie by list order, so the card does not flip between renders", () => {
    const now = new Date("2026-07-16T18:00:00Z");
    const red = makeSession({ id: "red", platform: "Red", startTime: "3:00 PM" });
    const blue = makeSession({ id: "blue", platform: "Blue", startTime: "15:00" });
    expect(selectNextSession([red, blue], MEET_NAME, makeMeet(), now)?.session.id).toBe("red");
    expect(selectNextSession([blue, red], MEET_NAME, makeMeet(), now)?.session.id).toBe("blue");
  });

  it("skips a session whose date or time cannot be converted and keeps looking", () => {
    const now = new Date("2026-07-16T18:00:00Z");
    const impossibleDate = makeSession({ id: "bad-date", date: "2026-02-30", startTime: "2:30 PM" });
    const badClock = makeSession({ id: "bad-clock", startTime: "25:99" });
    const good = makeSession({ id: "good", startTime: "5:00 PM" });
    expect(
      selectNextSession([impossibleDate, badClock, good], MEET_NAME, makeMeet(), now)?.session.id,
    ).toBe("good");
  });

  it("returns null when the meet has no time zone rather than using the device zone", () => {
    const meet = makeMeet();
    meet.time = { ...meet.time, timeZoneIdentifier: "" as Meet["time"]["timeZoneIdentifier"] };
    expect(
      selectNextSession([makeSession()], MEET_NAME, meet, new Date("2026-07-16T18:00:00Z")),
    ).toBeNull();
  });
});
