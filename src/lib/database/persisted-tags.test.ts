import AsyncStorage from "@react-native-async-storage/async-storage";

import { clearHttpValidatorCache } from "@/lib/api/revalidated-reads";
import { setApiTransportForTests, type ApiCall } from "@/lib/api/transport";
import { standardsResource } from "@/lib/database/fetch-standards";
import { nationalRankingsResource } from "@/lib/database/fetch-national-rankings";
import { OFFLINE_CACHE_KEYS } from "@/lib/database/offline-cache";

jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(async () => true),
  subscribeToNetworkChanges: () => () => {},
}));

let mockBundle = "update-1:42:3.0.0";
jest.mock("@/lib/database/persisted-tag", () => {
  const actual = jest.requireActual("@/lib/database/persisted-tag");
  return {
    ...actual,
    encodePersistedTag: (tag: string | null | undefined) => actual.encodePersistedTag(tag, mockBundle),
    decodePersistedTag: (stored: unknown) => actual.decodePersistedTag(stored, mockBundle),
  };
});

const standardRow = { age_category: "Senior", gender: "Men", weight_class: "89kg", standard_a: 300, standard_b: 280 };

function serverWithTag(tag: string, body: unknown) {
  const sent: (string | undefined)[] = [];
  setApiTransportForTests(async (call: ApiCall) => {
    if (call.kind === "clock") return Date.now();
    const ifNoneMatch = call.args.ifNoneMatch as string | undefined;
    sent.push(ifNoneMatch);
    if (ifNoneMatch === tag) return { etag: tag };
    return { etag: tag, json: JSON.stringify(body) };
  });
  return sent;
}

function restartProcess() {
  clearHttpValidatorCache();
}

beforeEach(async () => {
  await AsyncStorage.clear();
  restartProcess();
  mockBundle = "update-1:42:3.0.0";
});

afterAll(() => setApiTransportForTests(null));

describe("tags persisted with offline-cache bodies", () => {
  it("revalidates after a restart with the stored tag and keeps the stored body", async () => {
    const sent = serverWithTag('"s1"', [standardRow]);
    const first = await standardsResource.revalidate();
    expect(first.changed).toBe(true);

    restartProcess();
    const cached = await standardsResource.loadCached();
    expect(cached?.tag).toBe('"s1"');
    const second = await standardsResource.revalidateWithCached(cached);
    expect(sent).toEqual([undefined, '"s1"']);
    expect(second).toMatchObject({ changed: false, tag: '"s1"' });
    expect(second.data).toBe(cached?.data);
  });

  it("downloads in full after an app update, whose mapper may read the body differently", async () => {
    const sent = serverWithTag('"s1"', [standardRow]);
    await standardsResource.revalidate();

    restartProcess();
    mockBundle = "update-2:42:3.0.0";
    const cached = await standardsResource.loadCached();
    expect(cached?.tag).toBeUndefined();
    const result = await standardsResource.revalidateWithCached(cached);
    expect(sent).toEqual([undefined, undefined]);
    expect(result.changed).toBe(false);

    restartProcess();
    const retagged = await standardsResource.loadCached();
    expect(retagged?.tag).toBe('"s1"');
  });

  it("keeps a tag per browsed entry of a bounded cache", async () => {
    const sent = serverWithTag('"r1"', [{ name: "A Lifter", total: 300 }]);
    await nationalRankingsResource.revalidate("Senior 89");

    restartProcess();
    const cached = await nationalRankingsResource.loadCached("Senior 89");
    expect(cached?.tag).toBe('"r1"');
    const result = await nationalRankingsResource.revalidateWithCached(cached, "Senior 89");
    expect(sent).toEqual([undefined, '"r1"']);
    expect(result.changed).toBe(false);
  });

  it("drops a stored tag that is not a string", async () => {
    await AsyncStorage.setItem(
      OFFLINE_CACHE_KEYS.standards,
      JSON.stringify({ data: { senior: { men: [], women: [] } }, lastSynced: 1, tag: 7 }),
    );
    const cached = await standardsResource.loadCached();
    expect(cached?.tag).toBeUndefined();
  });
});
