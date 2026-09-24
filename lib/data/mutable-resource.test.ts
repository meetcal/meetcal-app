import {
  createMutableResource,
  RECONNECT_REFETCH_JITTER_MAX_MS,
  reconnectRefetchDelayMs,
} from "@/lib/data/mutable-resource";

describe("createMutableResource", () => {
  it("persists fresh data when it differs from cached data", async () => {
    const persistFresh = jest.fn(async (data: { value: number }) => ({
      data,
      lastUpdatedAt: 20,
    }));
    const resource = createMutableResource({
      getKey: () => "resource",
      loadCached: async () => ({
        data: { value: 1 },
        lastUpdatedAt: 10,
      }),
      fetchFresh: async () => ({ value: 2 }),
      persistFresh,
    });

    const result = await resource.revalidate();

    expect(result.changed).toBe(true);
    expect(result.data).toEqual({ value: 2 });
    expect(persistFresh).toHaveBeenCalledWith({ value: 2 });
  });

  it("does not persist unchanged fresh data", async () => {
    const persistFresh = jest.fn();
    const resource = createMutableResource({
      getKey: () => "resource",
      loadCached: async () => ({
        data: { value: 1 },
        lastUpdatedAt: 10,
      }),
      fetchFresh: async () => ({ value: 1 }),
      persistFresh,
    });

    const result = await resource.revalidate();

    expect(result.changed).toBe(false);
    expect(result.data).toEqual({ value: 1 });
    expect(persistFresh).not.toHaveBeenCalled();
  });

  it("serves the fresh data when the cache write fails", async () => {
    // A cache-write throw (storage full, a validator rejecting one row) used
    // to reject the whole refresh, so data that had already arrived never
    // reached the screen.
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const resource = createMutableResource({
      getKey: () => "unpersistable",
      loadCached: async () => ({ data: { value: 1 }, lastUpdatedAt: 10 }),
      fetchFresh: async () => ({ value: 2 }),
      persistFresh: async () => {
        throw new Error("SQLITE_FULL");
      },
    });

    const result = await resource.revalidate();

    expect(result.data).toEqual({ value: 2 });
    expect(result.changed).toBe(true);
    expect(result.lastUpdatedAt).toBe(10);
    expect(warn).toHaveBeenCalledWith(
      "Failed to persist fresh resource data; serving it uncached",
      expect.objectContaining({ key: "unpersistable" }),
    );
    warn.mockRestore();
  });

  it("dedupes concurrent revalidations by resource key", async () => {
    const fetchFresh = jest.fn(
      async () =>
        await new Promise<{ value: number }>((resolve) =>
          setTimeout(() => resolve({ value: 3 }), 0),
        ),
    );
    const resource = createMutableResource({
      getKey: () => "resource",
      loadCached: async () => null,
      fetchFresh,
      persistFresh: async (data) => ({
        data,
        lastUpdatedAt: 30,
      }),
    });

    const [first, second] = await Promise.all([
      resource.revalidate(),
      resource.revalidate(),
    ]);

    expect(first.data).toEqual({ value: 3 });
    expect(second.data).toEqual({ value: 3 });
    expect(fetchFresh).toHaveBeenCalledTimes(1);
  });
  // Regression: `invalidate` drops the in-flight entry for a key, so a request
  // started afterwards owns it. When the older request settled, its `.finally`
  // deleted whatever was registered under the key — the *newer* request — and
  // the map was empty while a fetch was still running, so the next caller
  // issued a duplicate request instead of joining the live one.
  it("does not let a superseded request unregister a newer one", async () => {
    const resolvers: ((value: { value: number }) => void)[] = [];
    const fetchFresh = jest.fn(
      () =>
        new Promise<{ value: number }>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const resource = createMutableResource({
      getKey: () => "shared",
      loadCached: async () => null,
      fetchFresh,
      persistFresh: async (data: { value: number }) => ({
        data,
        lastUpdatedAt: 1,
      }),
    });

    const tick = async () => {
      for (let i = 0; i < 4; i += 1) await Promise.resolve();
    };

    const first = resource.revalidate();
    await tick();
    await resource.invalidate();
    const second = resource.revalidate();
    await tick();
    expect(fetchFresh).toHaveBeenCalledTimes(2);

    // The superseded request settles first.
    resolvers[0]({ value: 1 });
    await first;
    await tick();

    // The live second request must still be joinable.
    const joined = resource.revalidate();
    await tick();
    expect(fetchFresh).toHaveBeenCalledTimes(2);

    resolvers[1]({ value: 2 });
    await expect(second).resolves.toMatchObject({ data: { value: 2 } });
    await expect(joined).resolves.toMatchObject({ data: { value: 2 } });
  });
});

describe("reconnectRefetchDelayMs", () => {
  it("spreads reconnect refetches over a bounded window", () => {
    expect(reconnectRefetchDelayMs(() => 0)).toBe(0);
    expect(reconnectRefetchDelayMs(() => 0.5)).toBe(
      Math.floor(RECONNECT_REFETCH_JITTER_MAX_MS / 2),
    );
    // `Math.random` is in [0, 1); guard the edge anyway.
    expect(reconnectRefetchDelayMs(() => 1)).toBe(RECONNECT_REFETCH_JITTER_MAX_MS - 1);
    for (let i = 0; i < 50; i += 1) {
      const delay = reconnectRefetchDelayMs();
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(RECONNECT_REFETCH_JITTER_MAX_MS);
    }
  });
});
