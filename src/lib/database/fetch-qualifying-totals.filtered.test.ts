import AsyncStorage from "@react-native-async-storage/async-storage";

import { clearHttpValidatorCache } from "@/lib/api/revalidated-reads";
import { jsonTransportStub } from "@/lib/api/json-transport-stub";
import { setApiTransportForTests } from "@/lib/api/transport";
import {
  categoriesFromRows,
  categoriesFromTotals,
  qualifyingTotalCategoriesResource,
  qualifyingTotalsForEventResource,
} from "@/lib/database/fetch-qualifying-totals";
import { OFFLINE_CACHE_KEYS } from "@/lib/database/offline-cache";

jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(async () => true),
  subscribeToNetworkChanges: () => () => {},
}));

const respond = jest.fn();
beforeAll(() => setApiTransportForTests(jsonTransportStub((path, query) => respond(path, query))));
afterAll(() => setApiTransportForTests(null));
beforeEach(async () => {
  respond.mockReset();
  clearHttpValidatorCache();
  await AsyncStorage.clear();
});

const total = (event: string, ageCategory: string, gender: string, weightClass: string, qualifyingTotal: number) => ({
  event_name: event,
  age_category: ageCategory,
  gender,
  weight_class: weightClass,
  qualifying_total: qualifyingTotal,
});

describe("qualifying totals for one event", () => {
  it("asks the server for that event only and keeps it for offline", async () => {
    respond.mockImplementation(async (path: string, query: Record<string, string>) => {
      expect(path).toBe("/data/qualifying-totals");
      expect(query).toEqual({ event: "2027 Nationals" });
      return [total("2027 Nationals", "Senior", "Men", "89", 300)];
    });
    const fresh = await qualifyingTotalsForEventResource.revalidate("2027 Nationals");
    expect(fresh.data).toEqual({ "2027 Nationals": { Senior: { Men: { "89": 300 }, Women: {} } } });
    await expect(qualifyingTotalsForEventResource.loadCached("2027 Nationals")).resolves.toMatchObject({
      data: fresh.data,
    });
  });

  it("reads one event out of a newer whole-table download", async () => {
    await AsyncStorage.setItem(
      OFFLINE_CACHE_KEYS.qualifyingTotals,
      JSON.stringify({ data: { A: { Senior: { Men: { "89": 1 }, Women: {} } }, B: {} }, lastSynced: 5 }),
    );
    await expect(qualifyingTotalsForEventResource.loadCached("A")).resolves.toEqual({
      data: { A: { Senior: { Men: { "89": 1 }, Women: {} } } },
      lastUpdatedAt: 5,
    });
    await expect(qualifyingTotalsForEventResource.loadCached("Missing")).resolves.toBeNull();
  });
});

describe("qualifying total categories", () => {
  it("groups each event's age groups, once each", () => {
    expect(
      categoriesFromRows([
        { event_name: "A", gender: "Men", age_category: "Senior" },
        { event_name: "A", gender: "Women", age_category: "Senior" },
        { event_name: "A", gender: "Men", age_category: "Junior" },
        { event_name: "B", gender: "Men", age_category: "Senior" },
      ]),
    ).toEqual({ events: ["A", "B"], ageGroupsByEvent: { A: ["Senior", "Junior"], B: ["Senior"] } });
    expect(categoriesFromTotals({ A: { Senior: { Men: {}, Women: {} } } })).toEqual({
      events: ["A"],
      ageGroupsByEvent: { A: ["Senior"] },
    });
  });

  it("reads the categories answer, drops incomplete rows, and keeps it for offline", async () => {
    respond.mockImplementation(async (path: string) => {
      expect(path).toBe("/data/qualifying-total-categories");
      return [
        { event_name: "A", gender: "Men", age_category: "Senior" },
        { event_name: null, gender: "Men", age_category: "Senior" },
        7,
      ];
    });
    await expect(qualifyingTotalCategoriesResource.revalidate()).resolves.toMatchObject({
      data: { events: ["A"], ageGroupsByEvent: { A: ["Senior"] } },
    });
    await expect(qualifyingTotalCategoriesResource.loadCached()).resolves.toMatchObject({
      data: { events: ["A"] },
    });
  });

  it("reads nothing from a stored categories entry of the wrong shape", async () => {
    await AsyncStorage.setItem(
      OFFLINE_CACHE_KEYS.qualifyingTotalCategories,
      JSON.stringify({ data: { events: "A" }, lastSynced: 1 }),
    );
    await expect(qualifyingTotalCategoriesResource.loadCached()).resolves.toBeNull();
  });
});
