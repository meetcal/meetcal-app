import {
  getOfflineCache,
  setOfflineCache,
} from "@/lib/database/offline-cache";

const mockMemory = new Map<string, string>();

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => mockMemory.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockMemory.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockMemory.delete(key);
  }),
}));

describe("offline cache", () => {
  beforeEach(() => {
    mockMemory.clear();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("round-trips a well-formed entry", async () => {
    await setOfflineCache("k", { rows: [1] });
    await expect(getOfflineCache("k")).resolves.toMatchObject({
      data: { rows: [1] },
    });
  });

  it("returns null for invalid JSON", async () => {
    mockMemory.set("k", "{nope");
    await expect(getOfflineCache("k")).resolves.toBeNull();
  });

  it("returns null when lastSynced is missing", async () => {
    mockMemory.set("k", JSON.stringify({ data: { rows: [] } }));
    await expect(getOfflineCache("k")).resolves.toBeNull();
  });

  it("returns null for an empty store", async () => {
    await expect(getOfflineCache("missing")).resolves.toBeNull();
  });
});
