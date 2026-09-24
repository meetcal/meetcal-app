/**
 * The Saved tab's schedule requests, counted at `fetch` through the real
 * schedule resource, `fetchSchedule` and API client. Only the offline store is
 * mocked (its compression is not what is under test).
 */
import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, create } from "react-test-renderer";

import type { MeetName } from "@/data/types/meet";
import type { Schedule } from "@/types/schedule";
import { useSavedScheduleLookup } from "@/hooks/saved-sessions/useSavedScheduleLookup";
import { clearHttpValidatorCache } from "@/lib/api/meetcal-api";
import { jsonFetchStub } from "@/lib/api/json-fetch-stub";
import { MEETS_LIST_CACHE_KEY } from "@/lib/database/meets-list-cache";

const mockGetMeetSchedule = jest.fn<Promise<Schedule>, [string]>(async () => []);

jest.mock("@/lib/database/offline-store", () => ({
  getMeetSchedule: (meet: string) => mockGetMeetSchedule(meet),
  saveMeetSchedule: jest.fn(async () => undefined),
  clearMeetSchedule: jest.fn(async () => undefined),
}));

jest.mock("@/lib/networkUtils", () => ({
  subscribeToNetworkChanges: jest.fn(() => () => {}),
}));

jest.mock("@/config/dev-mock-meet", () => ({
  isMockedMeet: jest.fn(async () => false),
  getMockSchedule: jest.fn(() => []),
  getMockAthletesWithSession: jest.fn(() => []),
}));

const MEETS = ["Meet A", "Meet B", "Meet C", "Meet D", "Meet E", "Meet F"];
const ALLOWED = new Set(MEETS);

const cachedMeet = (name: string) => ({
  id: name,
  name,
  venue: { name: "Hall", address: { street: "", city: "", state: "", zip: "" } },
  time: {
    timeZone: "America/Denver",
    timeZoneIdentifier: "America/Denver",
    abbreviation: "MDT",
    utcOffset: -6,
  },
  dates: { start: "2099-06-20", end: "2099-06-22" },
  status: "upcoming",
});

const SCHEDULE_ROWS = [
  {
    date: "2099-06-20",
    platform: "Red",
    session_id: 3,
    start_time: "10:00:00",
    weigh_in_time: "08:00:00",
    weight_class: "71kg",
  },
];

// One saved session in each of six meets: a full season.
const SAVED = MEETS.map((meet, index) => ({ meet, sessionNumber: index + 1 }));

let requests: string[] = [];
let captured: ReturnType<typeof useSavedScheduleLookup> | null = null;

function Harness({
  saved,
  selectedMeet,
}: {
  saved: { meet: string }[];
  selectedMeet: MeetName | null;
}) {
  const value = useSavedScheduleLookup(saved, selectedMeet, ALLOWED);
  // Assigned after commit, not during render, so the test double stays
  // within the rules of hooks; every read below happens after `act`.
  React.useEffect(() => {
    captured = value;
  });
  return null;
}

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

beforeEach(async () => {
  requests = [];
  captured = null;
  mockGetMeetSchedule.mockResolvedValue([]);
  clearHttpValidatorCache();
  await AsyncStorage.clear();
  await AsyncStorage.setItem(MEETS_LIST_CACHE_KEY, JSON.stringify(MEETS.map(cachedMeet)));
  const stub = jsonFetchStub((path, query) => {
    requests.push(`${path}?meet=${query.meet}`);
    if (path === "/meets/schedule") return SCHEDULE_ROWS;
    throw new Error(`unexpected ${path}`);
  });
  global.fetch = jest.fn(stub) as unknown as typeof fetch;
});

describe("useSavedScheduleLookup", () => {
  // Before: one /meets/details + one /meets/schedule per saved meet (12 here),
  // committed one meet at a time, for a tab that shows one meet.
  it("fetches only the selected meet's schedule, with no details request", async () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Harness saved={SAVED} selectedMeet={"Meet C" as MeetName} />);
    });
    await flush();

    expect(requests).toEqual(["/meets/schedule?meet=Meet C"]);
    expect(captured!.isLoading).toBe(false);
    expect([...captured!.sessionLookupByMeet.keys()]).toEqual(["Meet C"]);
    expect(captured!.sessionLookupByMeet.get("Meet C" as MeetName)?.get("3-Red")).toEqual(
      expect.objectContaining({ fullDate: "2099-06-20", weightClass: "71kg" }),
    );

    act(() => tree.unmount());
  });

  it("makes no request when nothing is saved for the selected meet", async () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <Harness saved={[{ meet: "Meet A" }]} selectedMeet={"Meet B" as MeetName} />,
      );
    });
    await flush();

    expect(requests).toEqual([]);
    expect(captured!.sessionLookupByMeet.size).toBe(0);
    expect(captured!.isLoading).toBe(false);

    act(() => tree.unmount());
  });

  it("serves the offline schedule when the network fails", async () => {
    mockGetMeetSchedule.mockResolvedValue([
      {
        date: "Saturday, June 20",
        fullDate: "2099-06-20",
        sessions: [
          {
            id: "s-3",
            number: 3,
            startTime: "10:00 AM",
            weighInTime: "8:00 AM",
            platforms: [
              { platform: "Red", weightClass: "71kg", platformStartTime: "10:00 AM" },
            ],
          },
        ],
      },
    ] as unknown as Schedule);
    global.fetch = jest.fn(async () => {
      throw new TypeError("Network request failed");
    }) as unknown as typeof fetch;
    jest.spyOn(console, "error").mockImplementation(() => {});

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Harness saved={SAVED} selectedMeet={"Meet A" as MeetName} />);
    });
    await flush();

    expect(captured!.sessionLookupByMeet.get("Meet A" as MeetName)?.get("3-Red")).toEqual(
      expect.objectContaining({ startTime: "10:00 AM", weighInTime: "8:00 AM" }),
    );

    act(() => tree.unmount());
    jest.restoreAllMocks();
  });
});
