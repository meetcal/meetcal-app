import {
  createDataWidgetRefresher,
  DATA_WIDGET_REFRESH_MIN_INTERVAL_MS,
  DATA_WIDGET_SOURCE_MAX_AGE_MS,
  readWidgetSource,
  type DataWidgetRefreshDeps,
} from "@/lib/data-widgets-refresh";
import type { MutableResource } from "@/lib/data/mutable-resource";
import {
  defaultWidgetSettings,
  type DataWidgetSourceData,
  type WidgetSettings,
} from "@/utils/dataWidgets";

const source: DataWidgetSourceData = {
  totalsData: {
    Nationals: { Senior: { Men: { "89": 300 } } },
  } as unknown as DataWidgetSourceData["totalsData"],
  standardsData: {
    u15: { men: [], women: [] },
    youth: { men: [], women: [] },
    junior: { men: [], women: [] },
    senior: { men: [{ weightClass: "89", a: 330, b: 310 }], women: [] },
  },
  intlRankings: [
    {
      meet: "Worlds",
      ranking: 1,
      name: "A Lifter",
      weightClass: "89",
      total: 350,
      percentA: 101,
      gender: "Men",
      ageCategory: "Senior",
    },
  ] as unknown as DataWidgetSourceData["intlRankings"],
};

/** Stored settings whose rankings meet matches the source. */
const storedSettings: WidgetSettings = {
  ...defaultWidgetSettings,
  intlRankings: { meet: "Worlds", ageCategory: "Senior", gender: "Men" },
};

function setup(overrides: Partial<DataWidgetRefreshDeps> = {}) {
  let now = 1_000_000;
  let writeCount = 0;
  const deps: DataWidgetRefreshDeps = {
    now: () => now,
    isAvailable: () => true,
    loadSource: jest.fn(async () => source),
    loadSettings: jest.fn(async () => storedSettings),
    saveSettings: jest.fn(async () => {}),
    sync: jest.fn(() => {
      writeCount += 1;
    }),
    getWriteCount: () => writeCount,
    ...overrides,
  };
  const refresher = createDataWidgetRefresher(deps);
  return {
    deps,
    refresher,
    advance: (ms: number) => {
      now += ms;
    },
    simulateScreenWrite: () => {
      writeCount += 1;
    },
  };
}

describe("createDataWidgetRefresher", () => {
  beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("builds the payloads from the stored settings and writes them", async () => {
    const { deps, refresher } = setup();

    await expect(refresher.refresh()).resolves.toBe("synced");

    expect(deps.sync).toHaveBeenCalledTimes(1);
    const payloads = jest.mocked(deps.sync).mock.calls[0][0];
    expect(payloads.qualifyingTotals.rows).toEqual([
      { leading: "89", title: "", trailing: "300kg" },
    ]);
    expect(payloads.intlRankings.rows[0]).toMatchObject({ title: "A Lifter" });
    // Nothing needed healing, so the stored settings are not rewritten.
    expect(deps.saveSettings).not.toHaveBeenCalled();
  });

  it("does nothing, and fetches nothing, without the native module", async () => {
    const { deps, refresher } = setup({ isAvailable: () => false });
    await expect(refresher.refresh()).resolves.toBe("unavailable");
    expect(deps.loadSource).not.toHaveBeenCalled();
  });

  it("shares one run between concurrent callers", async () => {
    let release: (value: DataWidgetSourceData) => void = () => {};
    const { deps, refresher } = setup({
      loadSource: jest.fn(
        () =>
          new Promise<DataWidgetSourceData>((resolve) => {
            release = resolve;
          }),
      ),
    });

    const first = refresher.refresh();
    const second = refresher.refresh();
    release(source);

    await expect(first).resolves.toBe("synced");
    await expect(second).resolves.toBe("synced");
    expect(deps.loadSource).toHaveBeenCalledTimes(1);
    expect(deps.sync).toHaveBeenCalledTimes(1);
  });

  it("throttles repeat refreshes (foregrounds) inside the minimum interval", async () => {
    const { deps, refresher, advance } = setup();

    await refresher.refresh();
    advance(DATA_WIDGET_REFRESH_MIN_INTERVAL_MS - 1);
    await expect(refresher.refresh()).resolves.toBe("throttled");
    expect(deps.loadSource).toHaveBeenCalledTimes(1);

    advance(1);
    await expect(refresher.refresh()).resolves.toBe("unchanged");
    expect(deps.loadSource).toHaveBeenCalledTimes(2);
    // Identical payloads are not rewritten.
    expect(deps.sync).toHaveBeenCalledTimes(1);
  });

  it("rewrites identical payloads after another writer touched the widgets", async () => {
    const { deps, refresher, advance, simulateScreenWrite } = setup();

    await refresher.refresh();
    simulateScreenWrite();
    advance(DATA_WIDGET_REFRESH_MIN_INTERVAL_MS);

    await expect(refresher.refresh()).resolves.toBe("synced");
    expect(deps.sync).toHaveBeenCalledTimes(2);
  });

  it("leaves the widgets alone when a source cannot be read", async () => {
    const { deps, refresher } = setup({ loadSource: jest.fn(async () => null) });
    await expect(refresher.refresh()).resolves.toBe("no-data");
    expect(deps.sync).not.toHaveBeenCalled();
  });

  it("leaves the widgets alone when the filters do not resolve against the data", async () => {
    const { deps, refresher } = setup({
      loadSource: jest.fn(async () => ({ ...source, intlRankings: [] })),
    });
    await expect(refresher.refresh()).resolves.toBe("unresolved");
    expect(deps.sync).not.toHaveBeenCalled();
  });

  it("persists healed filters before writing the widget", async () => {
    const order: string[] = [];
    const { deps, refresher } = setup({
      // Last season's meet is no longer offered; it heals to "Worlds".
      loadSettings: jest.fn(async () => ({
        ...storedSettings,
        intlRankings: { meet: "Old Meet", ageCategory: "Senior", gender: "Men" as const },
      })),
      saveSettings: jest.fn(async () => {
        order.push("save");
      }),
    });
    jest.mocked(deps.sync).mockImplementation(() => {
      order.push("sync");
    });

    await expect(refresher.refresh()).resolves.toBe("synced");
    expect(deps.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        intlRankings: expect.objectContaining({ meet: "Worlds" }),
      }),
    );
    expect(order).toEqual(["save", "sync"]);
  });

  it("does not overwrite a write the settings screen made while it was loading", async () => {
    let release: (value: DataWidgetSourceData) => void = () => {};
    const { deps, refresher, simulateScreenWrite } = setup({
      loadSource: jest.fn(
        () =>
          new Promise<DataWidgetSourceData>((resolve) => {
            release = resolve;
          }),
      ),
    });

    const pending = refresher.refresh();
    simulateScreenWrite();
    release(source);

    await expect(pending).resolves.toBe("superseded");
    expect(deps.sync).not.toHaveBeenCalled();
  });

  it("does not save healed filters once the settings screen has started a commit", async () => {
    let release: (value: DataWidgetSourceData) => void = () => {};
    const { deps, refresher, simulateScreenWrite } = setup({
      loadSource: jest.fn(
        () =>
          new Promise<DataWidgetSourceData>((resolve) => {
            release = resolve;
          }),
      ),
      loadSettings: jest.fn(async () => ({
        ...storedSettings,
        intlRankings: { meet: "Old Meet", ageCategory: "Senior", gender: "Men" as const },
      })),
    });

    const pending = refresher.refresh();
    // `markDataWidgetCommitStarted`: the screen's save is still in flight and
    // it has not synced the widget yet.
    simulateScreenWrite();
    release(source);

    await expect(pending).resolves.toBe("superseded");
    expect(deps.saveSettings).not.toHaveBeenCalled();
    expect(deps.sync).not.toHaveBeenCalled();
  });

  it("yields when the screen commits while the healed filters are being saved", async () => {
    const { deps, refresher, simulateScreenWrite } = setup({
      loadSettings: jest.fn(async () => ({
        ...storedSettings,
        intlRankings: { meet: "Old Meet", ageCategory: "Senior", gender: "Men" as const },
      })),
      saveSettings: jest.fn(async () => {
        simulateScreenWrite();
      }),
    });

    await expect(refresher.refresh()).resolves.toBe("superseded");
    expect(deps.sync).not.toHaveBeenCalled();
  });

  it("never rejects, and a run that found no data does not throttle the next one", async () => {
    const { deps, refresher } = setup({
      loadSettings: jest
        .fn()
        .mockRejectedValueOnce(new Error("storage"))
        .mockResolvedValue(storedSettings),
    });

    await expect(refresher.refresh()).resolves.toBe("no-data");
    await expect(refresher.refresh()).resolves.toBe("synced");
    expect(deps.sync).toHaveBeenCalledTimes(1);
  });

  it("retries at the next foreground after an offline launch with no cache", async () => {
    const loadSource = jest
      .fn<Promise<DataWidgetSourceData | null>, [number]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(source);
    const { refresher } = setup({ loadSource });

    await expect(refresher.refresh()).resolves.toBe("no-data");
    await expect(refresher.refresh()).resolves.toBe("synced");
    expect(loadSource).toHaveBeenCalledTimes(2);
  });
});

describe("readWidgetSource", () => {
  const now = 10 * DATA_WIDGET_SOURCE_MAX_AGE_MS;

  function resource(
    cached: { data: string; lastUpdatedAt: number | null } | null,
    revalidate: () => Promise<string>,
  ): MutableResource<string, []> {
    return {
      getKey: () => "key",
      loadCached: jest.fn(async () => cached),
      revalidate: jest.fn(),
      revalidateWithCached: jest.fn(async () => ({
        data: await revalidate(),
        changed: true,
        lastUpdatedAt: now,
        source: "network" as const,
      })),
      invalidate: jest.fn(),
      subscribe: jest.fn(() => () => {}),
      isEqual: (left, right) => left === right,
    };
  }

  it("uses a fresh cached copy without a network request", async () => {
    const r = resource({ data: "cached", lastUpdatedAt: now - 1 }, async () => "fresh");
    await expect(readWidgetSource(r, now, new Map())).resolves.toBe("cached");
    expect(r.revalidateWithCached).not.toHaveBeenCalled();
  });

  it("revalidates an old cached copy", async () => {
    const r = resource(
      { data: "cached", lastUpdatedAt: now - DATA_WIDGET_SOURCE_MAX_AGE_MS },
      async () => "fresh",
    );
    await expect(readWidgetSource(r, now, new Map())).resolves.toBe("fresh");
  });

  it("does not refetch an unchanged table on every refresh once its stamp is old", async () => {
    // An unchanged revalidation leaves the cache stamp where it was (the
    // resource only persists, and re-stamps, data that changed).
    const stale = { data: "same", lastUpdatedAt: now - 2 * DATA_WIDGET_SOURCE_MAX_AGE_MS };
    const r = resource(stale, async () => "same");
    const log = new Map<string, number>();

    await expect(readWidgetSource(r, now, log)).resolves.toBe("same");
    await expect(readWidgetSource(r, now + 60_000, log)).resolves.toBe("same");
    expect(r.revalidateWithCached).toHaveBeenCalledTimes(1);

    // Six hours after the last check it is confirmed again.
    await expect(readWidgetSource(r, now + DATA_WIDGET_SOURCE_MAX_AGE_MS, log)).resolves.toBe("same");
    expect(r.revalidateWithCached).toHaveBeenCalledTimes(2);
  });

  it("does not record a check that failed", async () => {
    const r = resource({ data: "cached", lastUpdatedAt: null }, async () => {
      throw new Error("Offline");
    });
    const log = new Map<string, number>();
    await readWidgetSource(r, now, log);
    expect(log.size).toBe(0);
  });

  it("falls back to the stale copy when the network fails", async () => {
    const r = resource({ data: "cached", lastUpdatedAt: null }, async () => {
      throw new Error("Offline");
    });
    await expect(readWidgetSource(r, now, new Map())).resolves.toBe("cached");
  });

  it("is null with neither cache nor network", async () => {
    const r = resource(null, async () => {
      throw new Error("Offline");
    });
    await expect(readWidgetSource(r, now, new Map())).resolves.toBeNull();
  });
});
