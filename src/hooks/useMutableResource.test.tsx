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

  // A reconnect or pull-to-refresh re-read and re-parsed the stored copy to
  // compare (for the schedule, the whole meet) and handed every consumer a
  // new object even when nothing changed.
  it("compares a refresh with what is on screen and keeps its identity when unchanged", async () => {
    const loadCached = jest.fn(async () => ({ data: [{ id: "same" }], lastUpdatedAt: 1 }));
    const resource = createMutableResource<Row[], [string]>({
      getKey: (param) => `identity:${param}`,
      loadCached,
      fetchFresh: async () => [{ id: "same" }],
      persistFresh: async (data) => ({ data, lastUpdatedAt: 2 }),
    });
    harness(resource, "a");
    await flush();
    await flush();
    const shown = captured!.data;
    loadCached.mockClear();

    await act(async () => {
      await captured!.refresh();
    });

    expect(loadCached).not.toHaveBeenCalled();
    expect(captured!.data).toBe(shown);
  });

  // After a failed write the screen no longer matched storage, and every
  // later refresh with the same answer compared equal to the screen and
  // skipped the write: the stale stored copy came back offline.
  it("writes an answer again after its earlier write failed", async () => {
    const persistFresh = jest
      .fn<Promise<ResourceCacheEntry<Row[]>>, [Row[]]>()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockImplementation(async (data) => ({ data, lastUpdatedAt: 3 }));
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const resource = createMutableResource<Row[], [string]>({
      getKey: (param) => `stored-again:${param}`,
      loadCached: async () => ({ data: [{ id: "old" }], lastUpdatedAt: 1 }),
      fetchFresh: async () => [{ id: "new" }],
      persistFresh: (data) => persistFresh(data),
    });
    harness(resource, "a");
    await flush();
    await flush();
    expect(captured!.data).toEqual([{ id: "new" }]);
    expect(persistFresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      await captured!.refresh();
    });

    expect(persistFresh).toHaveBeenCalledTimes(2);
    jest.restoreAllMocks();
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

  it("takes a revalidate started elsewhere, keeping the value when it is unchanged", async () => {
    let fresh: Row[] = [{ id: "v1" }];
    const resource = createMutableResource<Row[], [string]>({
      getKey: (param) => `shared:${param}`,
      loadCached: async () => null,
      fetchFresh: async () => fresh,
      persistFresh: async () => null,
    });

    harness(resource, "a");
    await flush();
    const first = captured!.data;
    expect(first).toEqual([{ id: "v1" }]);

    // Same rows, new array: nothing downstream should re-render for it.
    fresh = [{ id: "v1" }];
    await act(async () => {
      await resource.revalidate("a");
    });
    expect(captured!.data).toBe(first);

    fresh = [{ id: "v2" }];
    await act(async () => {
      await resource.revalidate("a");
    });
    expect(captured!.data).toEqual([{ id: "v2" }]);

    // Another key's answer is not this screen's.
    fresh = [{ id: "other" }];
    await act(async () => {
      await resource.revalidate("b");
    });
    expect(captured!.data).toEqual([{ id: "v2" }]);
  });

  it("does not repaint a published answer with a disk copy read before it", async () => {
    let releaseCache!: (entry: ResourceCacheEntry<Row[]>) => void;
    const resource = createMutableResource<Row[], [string]>({
      getKey: (param) => `race:${param}`,
      loadCached: jest
        .fn()
        // The hook's own slow disk read...
        .mockImplementationOnce(
          () => new Promise<ResourceCacheEntry<Row[]>>((resolve) => {
            releaseCache = resolve;
          }),
        )
        // ...and the background revalidate's.
        .mockResolvedValue(null),
      fetchFresh: jest
        .fn()
        .mockResolvedValueOnce([{ id: "fresh" }])
        // Any later revalidate stays out, so a stale repaint would show.
        .mockImplementation(() => new Promise(() => {})),
      persistFresh: async () => null,
    });

    harness(resource, "a");
    await flush();
    await act(async () => {
      await resource.revalidate("a");
    });
    expect(captured!.data).toEqual([{ id: "fresh" }]);

    await act(async () => {
      releaseCache({ data: [{ id: "stale" }], lastUpdatedAt: 1 });
    });
    await flush();
    expect(captured!.data).toEqual([{ id: "fresh" }]);
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
    let refreshed: boolean | undefined;
    await act(async () => {
      refreshed = await captured!.refresh();
    });
    await flush();

    expect(refreshed).toBe(true);
    expect(captured!.data).toEqual([{ id: "fresh" }]);
    expect(captured!.refreshError).toBeNull();
    expect(captured!.error).toBeNull();
  });

  // A pull-to-refresh awaits `refresh` and has to know it failed: the
  // failure only lands in state, which its closure cannot see.
  it("resolves false from a refresh that failed, without rejecting", async () => {
    const resource = createMutableResource<Row[], [string]>({
      getKey: (param) => `refresh-outcome:${param}`,
      loadCached: async () => ({ data: [{ id: "cached" }], lastUpdatedAt: 1 }),
      fetchFresh: async () => {
        throw new Error("Offline");
      },
      persistFresh: async (data) => ({ data, lastUpdatedAt: Date.now() }),
    });

    harness(resource, "a");
    await flush();

    let refreshed: boolean | undefined;
    await act(async () => {
      refreshed = await captured!.refresh();
    });

    expect(refreshed).toBe(false);
    expect(captured!.data).toEqual([{ id: "cached" }]);
    expect(captured!.refreshError).toBe("Offline");
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

  it("reports a new key failure as an initial error after a warm previous key", async () => {
    const resource = createMutableResource<Row[], [string]>({
      getKey: (param) => `warm-switch:${param}`,
      loadCached: async (param) => param === "a"
        ? { data: [{ id: "a" }], lastUpdatedAt: 1 }
        : null,
      fetchFresh: async (param) => {
        if (param === "b") throw new Error("New key unavailable");
        return [{ id: "a" }];
      },
      persistFresh: async (data) => ({ data, lastUpdatedAt: 1 }),
    });
    const { update } = harness(resource, "a");
    await flush();
    expect(captured!.source).not.toBeNull();
    update("b");
    await flush();
    expect(captured!.data).toEqual([]);
    expect(captured!.error).toBe("New key unavailable");
    expect(captured!.refreshError).toBeNull();
  });

});
