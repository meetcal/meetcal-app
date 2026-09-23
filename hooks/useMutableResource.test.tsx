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
    initialParam: string | null,
  ) {
    function Harness({ param }: { param: string | null }) {
      captured = useMutableResource({
        resource,
        params: param === null ? null : [param],
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
      update: (param: string | null) =>
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

  it("stays idle until params arrive, then loads", async () => {
    const fetchFresh = jest.fn(async () => [{ id: "fresh" }]);
    const resource = createMutableResource<Row[], [string]>({
      getKey: (param) => `gated:${param}`,
      loadCached: async () => null,
      fetchFresh,
      persistFresh: async (data) => ({ data, lastUpdatedAt: Date.now() }),
    });

    function Harness({ param }: { param: string | null }) {
      captured = useMutableResource({
        resource,
        params: param === null ? null : [param],
        initialData: [],
      });
      return null;
    }

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Harness param={null} />);
    });
    await flush();

    // Nothing to fetch yet: no request, and no spinner that would never end.
    expect(fetchFresh).not.toHaveBeenCalled();
    expect(captured!.isInitialLoading).toBe(false);

    act(() => {
      tree.update(<Harness param="a" />);
    });
    await flush();

    expect(fetchFresh).toHaveBeenCalledWith("a");
    expect(captured!.data).toEqual([{ id: "fresh" }]);
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
  it("clears previous rows and metadata when selection becomes unavailable", async () => {
    const resource = createMutableResource<Row[], [string]>({
      getKey: (param) => `disabled:${param}`,
      loadCached: async () => null,
      fetchFresh: async (param) => [{ id: param }],
      persistFresh: async (data) => ({ data, lastUpdatedAt: 1 }),
    });
    const { update } = harness(resource, "a");
    await flush();
    expect(captured!.data).toEqual([{ id: "a" }]);

    update(null);
    await flush();
    expect(captured!.data).toEqual([]);
    expect(captured!.source).toBeNull();
    expect(captured!.lastUpdatedAt).toBeNull();
    expect(captured!.isInitialLoading).toBe(false);
    expect(captured!.isRefreshing).toBe(false);
  });

  it("does not clear a new selection when an old invalidation finishes", async () => {
    let finishInvalidation!: () => void;
    const resource = createMutableResource<Row[], [string]>({
      getKey: (param) => `invalidate-switch:${param}`,
      loadCached: async () => null,
      fetchFresh: async (param) => [{ id: param }],
      persistFresh: async (data) => ({ data, lastUpdatedAt: 1 }),
      clearCached: () => new Promise<void>((resolve) => {
        finishInvalidation = resolve;
      }),
    });
    const { update } = harness(resource, "a");
    await flush();
    const invalidation = captured!.invalidate();
    update("b");
    await flush();
    await act(async () => {
      finishInvalidation();
      await invalidation;
    });
    expect(captured!.data).toEqual([{ id: "b" }]);
    expect(captured!.isInitialLoading).toBe(false);
  });

});
