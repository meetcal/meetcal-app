import React from "react";
import { act, create } from "react-test-renderer";
import { useMutableResource } from "@/hooks/useMutableResource";
import {
  createMutableResource,
  ResourceCacheEntry,
} from "@/lib/data/mutable-resource";

jest.mock("@/lib/networkUtils", () => ({
  subscribeToNetworkChanges: jest.fn(() => () => {}),
}));

type Row = { id: string };

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("useMutableResource", () => {
  let captured: ReturnType<typeof useMutableResource<Row[], [string]>> | null =
    null;

  function harness(
    resource: ReturnType<typeof createMutableResource<Row[], [string]>>,
    initialParam: string,
  ) {
    function Harness({ param }: { param: string }) {
      captured = useMutableResource({
        resource,
        params: [param] as [string],
        initialData: [],
      });
      return null;
    }
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Harness param={initialParam} />);
    });
    return {
      tree,
      update: (param: string) =>
        act(() => {
          tree.update(<Harness param={param} />);
        }),
    };
  }

  beforeEach(() => {
    captured = null;
  });

  it("keeps cached rows on screen when the background revalidate fails", async () => {
    const cached: ResourceCacheEntry<Row[]> = {
      data: [{ id: "cached" }],
      lastUpdatedAt: 1,
    };
    const resource = createMutableResource<Row[], [string]>({
      getKey: (param) => `offline:${param}`,
      loadCached: async () => cached,
      fetchFresh: async () => {
        throw new Error("Offline");
      },
      persistFresh: async (data) => ({ data, lastUpdatedAt: Date.now() }),
    });

    harness(resource, "a");
    await flush();

    // The whole point of the offline cache: the rows stay.
    expect(captured!.data).toEqual([{ id: "cached" }]);
    // `error` blanks the table in DataTable, so it must stay clear here.
    expect(captured!.error).toBeNull();
    expect(captured!.refreshError).toBe("Offline");
    expect(captured!.isInitialLoading).toBe(false);
  });

  it("reports an error when there is no cache to fall back on", async () => {
    const resource = createMutableResource<Row[], [string]>({
      getKey: (param) => `nocache:${param}`,
      loadCached: async () => null,
      fetchFresh: async () => {
        throw new Error("Offline");
      },
      persistFresh: async (data) => ({ data, lastUpdatedAt: Date.now() }),
    });

    harness(resource, "a");
    await flush();

    expect(captured!.data).toEqual([]);
    expect(captured!.error).toBe("Offline");
    expect(captured!.refreshError).toBeNull();
  });

  it("does not let a slow request for the old key overwrite the new one", async () => {
    const resolvers = new Map<string, (rows: Row[]) => void>();
    const resource = createMutableResource<Row[], [string]>({
      getKey: (param) => `switch:${param}`,
      loadCached: async () => null,
      fetchFresh: (param) =>
        new Promise<Row[]>((resolve) => {
          resolvers.set(param, resolve);
        }),
      persistFresh: async (data) => ({ data, lastUpdatedAt: Date.now() }),
    });

    const { update } = harness(resource, "men");
    await flush();

    // Switch to the women filter while the men request is still in flight.
    update("women");
    await flush();

    await act(async () => {
      resolvers.get("women")!([{ id: "women" }]);
      await Promise.resolve();
    });
    await flush();
    expect(captured!.data).toEqual([{ id: "women" }]);

    // The stale men response lands last and must be dropped.
    await act(async () => {
      resolvers.get("men")!([{ id: "men" }]);
      await Promise.resolve();
    });
    await flush();

    expect(captured!.data).toEqual([{ id: "women" }]);
  });

  it("clears refreshError once a revalidate succeeds", async () => {
    let shouldFail = true;
    const resource = createMutableResource<Row[], [string]>({
      getKey: (param) => `recover:${param}`,
      loadCached: async () => ({ data: [{ id: "cached" }], lastUpdatedAt: 1 }),
      fetchFresh: async () => {
        if (shouldFail) throw new Error("Offline");
        return [{ id: "fresh" }];
      },
      persistFresh: async (data) => ({ data, lastUpdatedAt: Date.now() }),
    });

    harness(resource, "a");
    await flush();
    expect(captured!.refreshError).toBe("Offline");

    shouldFail = false;
    await act(async () => {
      await captured!.refresh();
    });
    await flush();

    expect(captured!.data).toEqual([{ id: "fresh" }]);
    expect(captured!.refreshError).toBeNull();
    expect(captured!.error).toBeNull();
  });
});
