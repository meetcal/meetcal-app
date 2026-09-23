import React from "react";
import { act, create } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSavedSessions } from "@/hooks/useSavedSessions";
import { fetchSchedule } from "@/lib/database/queries";
import {
  NOTIFICATION_ENABLED_KEY,
  scheduleNotification,
} from "@/utils/notifications";
import type { LiftResult } from "@/data/types/athletes";
import type { Schedule } from "@/types/schedule";

jest.mock("@clerk/expo", () => ({
  useUser: () => ({ user: null }),
  useAuth: () => ({ getToken: jest.fn(async () => null) }),
}));

jest.mock("@/contexts/SelectedMeetContext", () => ({
  useSelectedMeet: () => ({ selectedMeet: null }),
}));

jest.mock("@/lib/database/queries", () => ({
  fetchSchedule: jest.fn(),
}));

jest.mock("@/lib/database/offline-store", () => ({
  getMeetData: jest.fn(async () => ({ schedule: null })),
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
}));

jest.mock("@/data/meets/config", () => ({
  getMeetConfig: jest.fn(async () => ({
    time: { timeZoneIdentifier: "America/New_York" },
  })),
  convertToUTC: jest.fn(() => new Date("2099-01-01T15:00:00.000Z")),
}));

jest.mock("@/lib/api/meetcal-api", () => ({
  deleteSavedSession: jest.fn(),
  deleteSavedSessions: jest.fn(),
  fetchSavedSessions: jest.fn(),
  fetchUserPreferences: jest.fn(),
  putSavedSession: jest.fn(),
}));

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

/**
 * `AsyncStorage` is already a jest mock and `jest.clearAllMocks()` runs in
 * `beforeEach`, so its own call log is the counter. Deliberately not a
 * `jest.spyOn` + `mockRestore` pair: restoring a spy that wrapped an existing
 * mock strips that mock's implementation for the rest of the file.
 */
function countNotificationFlagReads(): number {
  const getItem = AsyncStorage.getItem as jest.MockedFunction<
    typeof AsyncStorage.getItem
  >;
  return getItem.mock.calls.filter(([key]) => key === NOTIFICATION_ENABLED_KEY)
    .length;
}

type Hook = ReturnType<typeof useSavedSessions>;

async function mountHook(): Promise<{ current: Hook }> {
  const ref: { current: Hook } = { current: null as unknown as Hook };
  function Harness() {
    ref.current = useSavedSessions();
    return null;
  }
  await act(async () => {
    create(<Harness />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return ref;
}

describe("saveSessionsFromAthletes", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    // Notification scheduling is the only thing that needs the schedule, so it
    // has to be on for this to measure anything.
    await AsyncStorage.setItem(NOTIFICATION_ENABLED_KEY, "true");
    mockFetchSchedule.mockResolvedValue(SCHEDULE);
  });

  it("fetches the meet schedule once for the whole batch", async () => {
    const hook = await mountHook();

    await act(async () => {
      await hook.current.saveSessionsFromAthletes(
        ATHLETES,
        "Test Meet" as never,
      );
    });

    // Once for the batch itself. Before this, every saved session re-fetched
    // the same meet's schedule inside the notification step — and because the
    // save loop is sequential, `fetchSchedule`'s in-flight de-duplication
    // never applied.
    expect(mockFetchSchedule).toHaveBeenCalledTimes(1);
    expect(hook.current.savedSessions).toHaveLength(3);
  });

  it("does not fetch at all when the caller supplies the schedule", async () => {
    const hook = await mountHook();

    await act(async () => {
      await hook.current.saveSessionsFromAthletes(
        ATHLETES,
        "Test Meet" as never,
        SCHEDULE,
      );
    });

    expect(mockFetchSchedule).not.toHaveBeenCalled();
    expect(hook.current.savedSessions).toHaveLength(3);
  });

  it("still fetches for a single save that was given no schedule", async () => {
    const hook = await mountHook();

    await act(async () => {
      await hook.current.saveSession({
        id: "Test Meet-1-Red",
        meet: "Test Meet" as never,
        sessionNumber: 1,
        platform: "Red",
        weightClass: "71kg",
        startTime: "10:00 AM",
        weighInTime: "8:00 AM",
        date: "2099-06-20",
      });
    });

    expect(mockFetchSchedule).toHaveBeenCalledTimes(1);
  });

  it("reads the notification preference once for the whole batch", async () => {
    const hook = await mountHook();

    await act(async () => {
      await hook.current.saveSessionsFromAthletes(
        ATHLETES,
        "Test Meet" as never,
        SCHEDULE,
      );
    });

    // One user preference, read once — not once per saved session. The batch
    // is sequential and the flag cannot change between iterations, so the
    // per-session read was N-1 pure AsyncStorage round trips.
    expect(countNotificationFlagReads()).toBe(1);
    expect(hook.current.savedSessions).toHaveLength(3);
  });

  it("still reads the notification preference for a lone save", async () => {
    const hook = await mountHook();

    await act(async () => {
      await hook.current.saveSession(
        {
          id: "Test Meet-1-Red",
          meet: "Test Meet" as never,
          sessionNumber: 1,
          platform: "Red",
          weightClass: "71kg",
          startTime: "10:00 AM",
          weighInTime: "8:00 AM",
          date: "2099-06-20",
        },
        { schedule: SCHEDULE },
      );
    });

    // A caller that did not already resolve the flag must still get it.
    expect(countNotificationFlagReads()).toBe(1);
    expect(scheduleNotification).toHaveBeenCalledTimes(1);
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
