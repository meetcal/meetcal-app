import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { showToast } from "@/components/ui/Toast";
import type { LiftResult } from "@/data/types/athletes";
import { getMeetData, saveMeetAthletes, saveMeetSchedule } from "@/lib/database/offline-store";
import { fetchAthletesWithSession, fetchSchedule } from "@/lib/database/queries";
import { isNetworkAvailable } from "@/lib/networkUtils";
import type { Schedule } from "@/types/schedule";
import { FRESH_SNAPSHOT_TTL_MS, isSnapshotFresh, useStartListData } from "./useStartListData";

jest.mock("@/components/ui/Toast", () => ({ showToast: jest.fn() }));
jest.mock("@/lib/database/offline-store", () => ({
  getMeetData: jest.fn(),
  saveMeetAthletes: jest.fn(async () => {}),
  saveMeetSchedule: jest.fn(async () => {}),
}));
jest.mock("@/lib/database/queries", () => ({
  fetchAthletesWithSession: jest.fn(),
  fetchSchedule: jest.fn(),
}));
jest.mock("@/lib/networkUtils", () => ({ isNetworkAvailable: jest.fn() }));

const lifter = (name: string) => ({ name }) as unknown as LiftResult;
const day = (fullDate: string) => ({ date: fullDate, fullDate, sessions: [] }) as Schedule[number];

const CACHED = { athletes: [lifter("Cached")], schedule: [day("2026-06-20")] };
const FRESH = { athletes: [lifter("Fresh")], schedule: [day("2026-06-21")] };

function cache(athletesSyncedAt: number) {
  jest.mocked(getMeetData).mockResolvedValue({
    ...CACHED,
    athletesSyncedAt,
  } as unknown as Awaited<ReturnType<typeof getMeetData>>);
}

let hook!: ReturnType<typeof useStartListData>;
function Harness({ meet }: { meet: string | null }) {
  const value = useStartListData(meet);
  React.useEffect(() => {
    hook = value;
  });
  return null;
}

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  });
};

let tree: ReactTestRenderer | undefined;
async function mount(meet: string | null = "Meet A") {
  act(() => {
    tree = create(<Harness meet={meet} />);
  });
  await flush();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "info").mockImplementation(() => {});
  jest.mocked(isNetworkAvailable).mockResolvedValue(true);
  jest.mocked(fetchAthletesWithSession).mockResolvedValue(FRESH.athletes);
  jest.mocked(fetchSchedule).mockResolvedValue(FRESH.schedule);
});

afterEach(() => {
  const mounted = tree;
  if (mounted) act(() => mounted.unmount());
  tree = undefined;
  jest.restoreAllMocks();
});

describe("isSnapshotFresh", () => {
  it("is fresh only for a roster written inside the TTL", () => {
    expect(isSnapshotFresh(0, 1000)).toBe(false);
    expect(isSnapshotFresh(1000, 1000 + FRESH_SNAPSHOT_TTL_MS - 1)).toBe(true);
    expect(isSnapshotFresh(1000, 1000 + FRESH_SNAPSHOT_TTL_MS)).toBe(false);
  });
});

describe("useStartListData", () => {
  it("serves a just-written snapshot without going to the network", async () => {
    cache(Date.now());
    await mount();
    expect(hook.loading).toBe(false);
    expect(hook.athletes).toEqual(CACHED.athletes);
    expect(fetchAthletesWithSession).not.toHaveBeenCalled();
  });

  it("revalidates a stale snapshot and saves what came back", async () => {
    cache(Date.now() - FRESH_SNAPSHOT_TTL_MS - 1);
    await mount();
    expect(hook.athletes).toEqual(FRESH.athletes);
    expect(hook.schedule).toEqual(FRESH.schedule);
    expect(saveMeetAthletes).toHaveBeenCalledWith("Meet A", FRESH.athletes);
    expect(saveMeetSchedule).toHaveBeenCalledWith("Meet A", FRESH.schedule);
  });

  it("keeps the cached half when only one fetch fails", async () => {
    cache(0);
    jest.mocked(fetchSchedule).mockRejectedValue(new Error("down"));
    await mount();
    expect(hook.athletes).toEqual(FRESH.athletes);
    expect(hook.schedule).toEqual(CACHED.schedule);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("tells the user when a pull-to-refresh cannot reach the network", async () => {
    cache(Date.now());
    await mount();
    jest.mocked(isNetworkAvailable).mockResolvedValue(false);
    await act(async () => {
      await hook.refresh();
    });
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
    expect(hook.athletes).toEqual(CACHED.athletes);
    expect(hook.refreshing).toBe(false);
  });

  it("does not let a slower load for the previous meet overwrite the new one", async () => {
    let resolveA!: (value: unknown) => void;
    jest
      .mocked(getMeetData)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveA = resolve)) as never)
      .mockResolvedValue({
        athletes: [lifter("B")],
        schedule: [day("2026-07-01")],
        athletesSyncedAt: Date.now(),
      } as unknown as Awaited<ReturnType<typeof getMeetData>>);
    await mount("Meet A");
    act(() => tree?.update(<Harness meet="Meet B" />));
    await flush();
    await act(async () => {
      resolveA({ athletes: [lifter("A")], schedule: [], athletesSyncedAt: Date.now() });
    });
    await flush();
    expect(hook.athletes).toEqual([lifter("B")]);
  });

  it("shows nothing and stops loading with no meet", async () => {
    await mount(null);
    expect(hook.loading).toBe(false);
    expect(hook.athletes).toEqual([]);
    expect(getMeetData).not.toHaveBeenCalled();
  });
});
