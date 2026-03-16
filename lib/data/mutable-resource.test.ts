import { createMutableResource } from "@/lib/data/mutable-resource";

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
});
