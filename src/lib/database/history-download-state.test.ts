import { HISTORY_REFRESH_TTL_MS, planHistoryDownload, pruneHistorySyncedAt, prunePendingHistory } from "@/lib/database/history-download-state";

describe("pruneHistorySyncedAt", () => {
  it("keeps stamps younger than the TTL and drops the rest", () => {
    const now = 10 * HISTORY_REFRESH_TTL_MS;
    expect(
      pruneHistorySyncedAt(
        {
          fresh: now - 1,
          edge: now - HISTORY_REFRESH_TTL_MS,
          old: now - HISTORY_REFRESH_TTL_MS - 1,
        },
        now,
      ),
    ).toEqual({ fresh: now - 1 });
  });

  it("returns an empty map for no stamps", () => {
    expect(pruneHistorySyncedAt({}, Date.now())).toEqual({});
  });
});

describe("planHistoryDownload", () => {
  const now = Date.UTC(2026, 5, 20, 12);
  const roster = ["Athlete A", "Athlete B", "Athlete C"];
  const base = {
    rosterNames: roster,
    pending: undefined,
    syncedAt: now - 1000,
    packageChanged: false,
    force: false,
    now,
  };

  it("fetches only the gaps while the last full sync is fresh", async () => {
    const findMissing = jest.fn(async () => ["Athlete B"]);
    await expect(planHistoryDownload({ ...base, findMissing })).resolves.toEqual({
      names: ["Athlete B"],
      fullRefresh: false,
      since: now,
      track: false,
    });
  });

  it("fetches a changed package's athletes and the gaps, tracked but not a full refresh", async () => {
    const findMissing = jest.fn(async () => ["Athlete B"]);
    await expect(
      planHistoryDownload({
        ...base,
        packageChanged: true,
        changedNames: ["athlete a", "Not On Roster"],
        findMissing,
      }),
    ).resolves.toEqual({
      names: ["Athlete A", "Athlete B"],
      fullRefresh: false,
      since: now,
      track: true,
    });
  });

  it("still refreshes the whole roster for a changed package once the last full sync is stale", async () => {
    const findMissing = jest.fn(async () => []);
    await expect(
      planHistoryDownload({
        ...base,
        syncedAt: now - HISTORY_REFRESH_TTL_MS,
        packageChanged: true,
        changedNames: ["Athlete A"],
        findMissing,
      }),
    ).resolves.toEqual({ names: roster, fullRefresh: true, since: now, track: true });
  });

  it("refreshes the whole roster over a partial pass once the full sync is due", async () => {
    const findMissing = jest.fn(async () => []);
    await expect(
      planHistoryDownload({
        ...base,
        syncedAt: now - HISTORY_REFRESH_TTL_MS,
        pending: { names: ["Athlete C"], since: now - 60_000, full: false },
        findMissing,
      }),
    ).resolves.toEqual({ names: roster, fullRefresh: true, since: now, track: true });
  });

  it("resumes an unfinished changed-package pass without stamping a full sync", async () => {
    const since = now - 60_000;
    const findMissing = jest.fn(async () => []);
    await expect(
      planHistoryDownload({
        ...base,
        pending: { names: ["Athlete C"], since, full: false },
        packageChanged: true,
        changedNames: ["Athlete A"],
        findMissing,
      }),
    ).resolves.toEqual({ names: ["Athlete C", "Athlete A"], fullRefresh: false, since, track: true });
  });

  it("refreshes the whole roster for a changed package or a stale sync, without probing storage", async () => {
    const findMissing = jest.fn(async () => []);
    for (const input of [
      { ...base, packageChanged: true },
      { ...base, syncedAt: now - HISTORY_REFRESH_TTL_MS },
      { ...base, force: true },
    ]) {
      await expect(planHistoryDownload({ ...input, findMissing })).resolves.toEqual({
        names: roster,
        fullRefresh: true,
        since: now,
        track: true,
      });
    }
    expect(findMissing).not.toHaveBeenCalled();
  });

  it("resumes a young unfinished refresh with its remainder and the gaps", async () => {
    const since = now - 60_000;
    const findMissing = jest.fn(async () => ["Athlete A"]);
    await expect(
      planHistoryDownload({
        ...base,
        syncedAt: 0,
        pending: { names: ["athlete c", "Not On Roster"], since },
        findMissing,
      }),
    ).resolves.toEqual({ names: ["Athlete C", "Athlete A"], fullRefresh: true, since, track: true });
  });

  it("refreshes the whole roster for a package new here, over a young unfinished refresh", async () => {
    const findMissing = jest.fn(async () => []);
    await expect(
      planHistoryDownload({
        ...base,
        packageChanged: true,
        pending: { names: ["Athlete C"], since: now - 60_000 },
        findMissing,
      }),
    ).resolves.toEqual({ names: roster, fullRefresh: true, since: now, track: true });
    expect(findMissing).not.toHaveBeenCalled();
  });

  it("ignores an unfinished refresh on Refresh All or once it is older than the TTL", async () => {
    const findMissing = jest.fn(async () => []);
    const pending = { names: ["Athlete C"], since: now - 60_000 };
    await expect(
      planHistoryDownload({ ...base, force: true, pending, findMissing }),
    ).resolves.toMatchObject({ names: roster });
    await expect(
      planHistoryDownload({
        ...base,
        syncedAt: 0,
        pending: { ...pending, since: now - HISTORY_REFRESH_TTL_MS },
        findMissing,
      }),
    ).resolves.toMatchObject({ names: roster, since: now });
  });
});

describe("prunePendingHistory", () => {
  it("drops unfinished refreshes that started a TTL or more ago", () => {
    const now = Date.now();
    expect(
      prunePendingHistory(
        {
          fresh: { names: ["A"], since: now - 1 },
          edge: { names: ["B"], since: now - HISTORY_REFRESH_TTL_MS },
        },
        now,
      ),
    ).toEqual({ fresh: { names: ["A"], since: now - 1 } });
  });
});
