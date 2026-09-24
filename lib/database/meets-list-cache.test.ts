import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Meet } from "@/data/types/meet";
import {
  getCachedMeetByName,
  getCachedMeets,
  MEETS_LIST_CACHE_KEY,
  setCachedMeets,
} from "@/lib/database/meets-list-cache";

const meet = (name: string): Meet =>
  ({
    id: name,
    name,
    venue: { name: "V", address: { street: "", city: "", state: "", zip: "" } },
    time: {
      timeZone: "Eastern",
      timeZoneIdentifier: "America/New_York",
      abbreviation: "EDT",
      utcOffset: 4,
    },
    dates: { start: "2026-06-20", end: "2026-06-21" },
    status: "upcoming",
  }) as Meet;

beforeEach(async () => {
  jest.restoreAllMocks();
  await AsyncStorage.clear();
});

describe("meets list cache", () => {
  it("round-trips the list and finds a meet by exact name", async () => {
    await setCachedMeets([meet("Nationals"), meet("Nationals 2")]);
    await expect(getCachedMeets()).resolves.toHaveLength(2);
    await expect(getCachedMeetByName("Nationals 2")).resolves.toMatchObject({
      name: "Nationals 2",
    });
    // No prefix or case-insensitive match: the name is the meet's key everywhere.
    await expect(getCachedMeetByName("nationals")).resolves.toBeNull();
    await expect(getCachedMeetByName("National")).resolves.toBeNull();
  });

  it("drops rows a screen could not render instead of returning them", async () => {
    const good = meet("Good Meet");
    await AsyncStorage.setItem(
      MEETS_LIST_CACHE_KEY,
      JSON.stringify([
        good,
        null,
        "Old Meet",
        { ...good, name: "" },
        { ...good, name: "No Time", time: undefined },
        { ...good, name: "No Zone", time: { ...good.time, timeZoneIdentifier: 5 } },
        { ...good, name: "No Dates", dates: null },
      ]),
    );
    const meets = await getCachedMeets();
    expect(meets.map((m) => m.name)).toEqual(["Good Meet"]);
    // A dropped row is a cache miss, so the caller goes to the network.
    await expect(getCachedMeetByName("No Zone")).resolves.toBeNull();
  });

  it.each([
    ["corrupt JSON", "{not json"],
    ["an object instead of a list", JSON.stringify({ name: "Meet" })],
    ["an empty string", ""],
  ])("reads %s as an empty cache", async (_label, raw) => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    await AsyncStorage.setItem(MEETS_LIST_CACHE_KEY, raw);
    await expect(getCachedMeets()).resolves.toEqual([]);
    await expect(getCachedMeetByName("Meet")).resolves.toBeNull();
  });

  it("treats a storage read failure as a miss, not a crash", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(AsyncStorage, "getItem").mockRejectedValueOnce(new Error("SQLITE_BUSY"));
    await expect(getCachedMeets()).resolves.toEqual([]);
    expect(error).toHaveBeenCalled();
  });

  it("swallows a storage write failure: the list is a cache, the fetch already succeeded", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("SQLITE_FULL"));
    await expect(setCachedMeets([meet("Nationals")])).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});
