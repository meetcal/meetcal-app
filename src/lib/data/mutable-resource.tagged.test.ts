import { createMutableResource, type TaggedFresh } from "@/lib/data/mutable-resource";

type Rows = { rows: number[] };

function taggedResource(options: {
  cached: { data: Rows; lastUpdatedAt: number; tag?: string | null } | null;
  answer: TaggedFresh<Rows>;
  isEqual?: (left: Rows, right: Rows) => boolean;
}) {
  const fetch = jest.fn(async (_knownTag: string | null) => options.answer);
  const persist = jest.fn(async (data: Rows, tag: string | null) => ({ data, lastUpdatedAt: 99, tag }));
  const fetchFresh = jest.fn(async () => ({ rows: [] }));
  const persistFresh = jest.fn();
  const isEqual = jest.fn(options.isEqual ?? (() => false));
  const resource = createMutableResource<Rows, []>({
    getKey: () => `tagged-${Math.random()}`,
    loadCached: async () => options.cached,
    fetchFresh,
    persistFresh,
    isEqual,
    tagged: { fetch, persist },
  });
  return { resource, fetch, persist, fetchFresh, persistFresh, isEqual };
}

describe("tagged revalidation", () => {
  it("sends the tag stored with the cached body and keeps that body when the server says unchanged", async () => {
    const cached = { data: { rows: [1] }, lastUpdatedAt: 10, tag: '"v1"' };
    const { resource, fetch, persist, isEqual, fetchFresh } = taggedResource({
      cached,
      answer: { status: "unchanged" },
    });
    const result = await resource.revalidate();
    expect(fetch).toHaveBeenCalledWith('"v1"');
    expect(fetchFresh).not.toHaveBeenCalled();
    expect(result).toEqual({ data: { rows: [1] }, changed: false, lastUpdatedAt: 10, source: "network", tag: '"v1"' });
    expect(result.data).toBe(cached.data);
    expect(persist).not.toHaveBeenCalled();
    expect(isEqual).not.toHaveBeenCalled();
  });

  it("sends no tag without a cached body", async () => {
    const { resource, fetch, persist } = taggedResource({
      cached: null,
      answer: { status: "fresh", data: { rows: [2] }, tag: '"v2"' },
    });
    const result = await resource.revalidate();
    expect(fetch).toHaveBeenCalledWith(null);
    expect(result).toMatchObject({ data: { rows: [2] }, changed: true, tag: '"v2"' });
    expect(persist).toHaveBeenCalledWith({ rows: [2] }, '"v2"');
  });

  it("stores a new body with its tag", async () => {
    const { resource, persist } = taggedResource({
      cached: { data: { rows: [1] }, lastUpdatedAt: 10, tag: '"v1"' },
      answer: { status: "fresh", data: { rows: [2] }, tag: '"v2"' },
    });
    const result = await resource.revalidate();
    expect(result).toMatchObject({ data: { rows: [2] }, changed: true, lastUpdatedAt: 99, tag: '"v2"' });
    expect(persist).toHaveBeenCalledWith({ rows: [2] }, '"v2"');
  });

  it("records the tag for an equal body that was stored without one, without reporting a change", async () => {
    const { resource, persist } = taggedResource({
      cached: { data: { rows: [1] }, lastUpdatedAt: 10, tag: null },
      answer: { status: "fresh", data: { rows: [1] }, tag: '"v1"' },
      isEqual: () => true,
    });
    const result = await resource.revalidate();
    expect(result).toMatchObject({ changed: false, tag: '"v1"', stored: true });
    expect(persist).toHaveBeenCalledWith({ rows: [1] }, '"v1"');
  });

  it("skips the equality check when the fresh answer carries the cached tag", async () => {
    const { resource, isEqual, persist } = taggedResource({
      cached: { data: { rows: [1] }, lastUpdatedAt: 10, tag: '"v1"' },
      answer: { status: "fresh", data: { rows: [1] }, tag: '"v1"' },
    });
    const result = await resource.revalidate();
    expect(result.changed).toBe(false);
    expect(isEqual).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("rejects an unchanged answer to a read that held nothing", async () => {
    const { resource } = taggedResource({ cached: null, answer: { status: "unchanged" } });
    await expect(resource.revalidate()).rejects.toThrow("answered unchanged with nothing cached");
  });

  it("tells subscribers about an unchanged answer, so every mounted copy settles", async () => {
    const cached = { data: { rows: [1] }, lastUpdatedAt: 10, tag: '"v1"' };
    const resource = createMutableResource<Rows, []>({
      getKey: () => "tagged-subscribed",
      loadCached: async () => cached,
      fetchFresh: async () => ({ rows: [] }),
      persistFresh: async () => null,
      tagged: { fetch: async () => ({ status: "unchanged" }), persist: async () => null },
    });
    const listener = jest.fn();
    resource.subscribe("tagged-subscribed", listener);
    await resource.revalidate();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ data: cached.data, changed: false, tag: '"v1"' }));
  });
});
