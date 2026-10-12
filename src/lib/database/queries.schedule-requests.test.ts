/**
 * Request counts for `fetchSchedule` through the real API client, with only
 * `fetch` stubbed. `queries.test.ts` mocks the API module and so cannot see
 * how many HTTP requests one schedule costs.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { clearHttpValidatorCache } from "@/lib/api/meetcal-api";
import { jsonTransportStub } from "@/lib/api/json-transport-stub";
import { setApiTransportForTests } from "@/lib/api/transport";
import { fetchSchedule } from "@/lib/database/queries";

jest.mock("@/config/dev-mock-meet", () => ({
  isMockedMeet: jest.fn(async () => false),
  getMockSchedule: jest.fn(() => []),
  getMockAthletesWithSession: jest.fn(() => []),
}));

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

let requests: string[] = [];

beforeEach(async () => {
  requests = [];
  clearHttpValidatorCache();
  await AsyncStorage.clear();
  const stub = jsonTransportStub((path) => {
    requests.push(path);
    if (path === "/meets/schedule") return SCHEDULE_ROWS;
    throw new Error(`unexpected ${path}`);
  });
  setApiTransportForTests(jest.fn(stub));
});

describe("fetchSchedule request count", () => {
  it("costs one /meets/schedule request, with no /meets/details companion", async () => {
    // Day titles are calendar dates read in UTC; the meet's zone, and the
    // /meets/details request that used to fetch it, is not needed.
    const schedule = await fetchSchedule("Cached Meet");

    expect(requests).toEqual(["/meets/schedule"]);
    expect(schedule).toHaveLength(1);
    expect(schedule[0].fullDate).toBe("2099-06-20");
  });
});

afterAll(() => {
  setApiTransportForTests(null);
});
