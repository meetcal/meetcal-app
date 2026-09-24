/**
 * Request counts for `fetchSchedule` through the real API client, with only
 * `fetch` stubbed. `queries.test.ts` mocks the API module and so cannot see
 * how many HTTP requests one schedule costs.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { clearHttpValidatorCache } from "@/lib/api/meetcal-api";
import { jsonFetchStub } from "@/lib/api/json-fetch-stub";
import { fetchSchedule } from "@/lib/database/queries";
import { MEETS_LIST_CACHE_KEY } from "@/lib/database/meets-list-cache";

jest.mock("@/config/dev-mock-meet", () => ({
  isMockedMeet: jest.fn(async () => false),
  getMockSchedule: jest.fn(() => []),
  getMockAthletesWithSession: jest.fn(() => []),
}));

const API_MEET = {
  name: "Cached Meet",
  start_date: "2099-06-20",
  end_date: "2099-06-22",
  time_zone: "America/Denver",
  venue_name: "Hall",
  venue_street: "1 Main St",
  venue_city: "Denver",
  venue_state: "CO",
  venue_zip: "80202",
  status: "upcoming",
};

const SCHEDULE_ROWS = [
  {
    date: "2099-06-20",
    platform: "Red",
    session_id: 1,
    start_time: "10:00:00",
    weigh_in_time: "08:00:00",
    weight_class: "71kg",
  },
];

// The cached list holds app `Meet` objects, as `fetchMeetsFresh` writes them.
const CACHED_MEET = {
  id: "Cached Meet",
  name: "Cached Meet",
  venue: { name: "Hall", address: { street: "", city: "", state: "", zip: "" } },
  time: {
    timeZone: "America/Denver",
    timeZoneIdentifier: "America/Denver",
    abbreviation: "MDT",
    utcOffset: -6,
  },
  dates: { start: "2099-06-20", end: "2099-06-22" },
  status: "upcoming",
};

let requests: string[] = [];

beforeEach(async () => {
  requests = [];
  clearHttpValidatorCache();
  await AsyncStorage.clear();
  const stub = jsonFetchStub((path) => {
    requests.push(path);
    if (path === "/meets/details") return API_MEET;
    if (path === "/meets/schedule") return SCHEDULE_ROWS;
    throw new Error(`unexpected ${path}`);
  });
  global.fetch = jest.fn(stub) as unknown as typeof fetch;
});

describe("fetchSchedule request count", () => {
  it("resolves the meet from the cached meets list instead of a /meets/details request", async () => {
    await AsyncStorage.setItem(MEETS_LIST_CACHE_KEY, JSON.stringify([CACHED_MEET]));

    const schedule = await fetchSchedule("Cached Meet");

    expect(requests).toEqual(["/meets/schedule"]);
    expect(schedule).toHaveLength(1);
    expect(schedule[0].fullDate).toBe("2099-06-20");
  });

  it("still asks /meets/details for a meet the cached list does not have", async () => {
    await AsyncStorage.setItem(MEETS_LIST_CACHE_KEY, JSON.stringify([CACHED_MEET]));

    await fetchSchedule("Other Meet");

    expect(requests.sort()).toEqual(["/meets/details", "/meets/schedule"]);
  });

  it("does not re-read the cache when the caller already looked and passed null", async () => {
    await AsyncStorage.setItem(MEETS_LIST_CACHE_KEY, JSON.stringify([CACHED_MEET]));
    const getItem = jest.mocked(AsyncStorage.getItem);
    getItem.mockClear();

    await fetchSchedule("Cached Meet", null);

    expect(getItem).not.toHaveBeenCalledWith(MEETS_LIST_CACHE_KEY);
    expect(requests.sort()).toEqual(["/meets/details", "/meets/schedule"]);
  });
});
