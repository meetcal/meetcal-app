const mockIsNetworkAvailable = jest.fn<Promise<boolean>, []>(async () => true);
jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: () => mockIsNetworkAvailable(),
}));

const mockPrefetchMeetData = jest.fn(async (_meet: string, _options?: unknown) => {});
jest.mock("@/lib/database/meet-manager", () => ({
  prefetchMeetData: (meet: string, options?: unknown) => mockPrefetchMeetData(meet, options),
}));

const mockMark = jest.fn(async (..._args: unknown[]) => {});
jest.mock("@/lib/database/offline-store", () => ({
  markMeetExplicitlyDownloaded: (...args: unknown[]) => mockMark(...args),
}));

import {
  describeOfflineRefresh,
  refreshOfflineDownloads,
  REFRESH_FAILURES_LISTED,
} from "@/lib/database/offline-refresh";

beforeEach(() => {
  jest.clearAllMocks();
  mockIsNetworkAvailable.mockReset();
  mockIsNetworkAvailable.mockResolvedValue(true);
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("refreshOfflineDownloads", () => {
  it("runs items one at a time, then meets, and records each outcome", async () => {
    const order: string[] = [];
    let active = 0;
    let peak = 0;
    const step = (name: string, fail = false) => async () => {
      active += 1;
      peak = Math.max(peak, active);
      order.push(name);
      await Promise.resolve();
      active -= 1;
      if (fail) throw new Error(`${name} failed`);
    };
    mockPrefetchMeetData.mockImplementation(async (meet) => step(meet, meet === "Meet B")());

    const result = await refreshOfflineDownloads(
      [
        { id: "standards", title: "Standards", download: step("Standards") },
        { id: "records", title: "Records", download: step("Records", true) },
      ],
      [{ name: "Meet A", endDate: "2099-06-22" }, { name: "Meet B" }],
    );

    expect(order).toEqual(["Standards", "Records", "Meet A", "Meet B"]);
    expect(peak).toBe(1);
    expect(result).toEqual({
      status: "done",
      refreshed: ["Standards", "Meet A"],
      failed: ["Records", "Meet B"],
      connectionLost: false,
    });
    expect(mockPrefetchMeetData).toHaveBeenCalledWith("Meet A", { forceHistoryRefresh: true });
    // Only a meet that refreshed is re-marked; a failed one keeps its old mark.
    expect(mockMark.mock.calls).toEqual([["Meet A", true, { endDate: "2099-06-22" }]]);
  });

  it("does nothing offline", async () => {
    mockIsNetworkAvailable.mockResolvedValue(false);
    const download = jest.fn(async () => {});

    await expect(
      refreshOfflineDownloads([{ id: "a", title: "A", download }], [{ name: "Meet A" }]),
    ).resolves.toEqual({ status: "offline" });
    expect(download).not.toHaveBeenCalled();
    expect(mockPrefetchMeetData).not.toHaveBeenCalled();
  });

  it("skips the rest once the connection is gone instead of timing each one out", async () => {
    mockIsNetworkAvailable.mockResolvedValueOnce(true).mockResolvedValue(false);
    const second = jest.fn(async () => {});

    const result = await refreshOfflineDownloads(
      [
        { id: "a", title: "A", download: async () => { throw new Error("Network request failed"); } },
        { id: "b", title: "B", download: second },
      ],
      [{ name: "Meet A" }],
    );

    expect(second).not.toHaveBeenCalled();
    expect(mockPrefetchMeetData).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "done",
      refreshed: [],
      failed: ["A", "B", "Meet A"],
      connectionLost: true,
    });
  });
});

describe("describeOfflineRefresh", () => {
  const done = (refreshed: string[], failed: string[], connectionLost = false) =>
    describeOfflineRefresh({ status: "done", refreshed, failed, connectionLost });

  it("says complete only when everything refreshed", () => {
    expect(done(["A"], []).title).toBe("Refresh Complete");
    expect(done(["A"], ["B"]).title).toBe("Refresh Incomplete");
    expect(done([], ["B"]).title).toBe("Refresh Failed");
    expect(done([], []).title).toBe("Nothing to Refresh");
    expect(describeOfflineRefresh({ status: "offline" }).title).toBe("You're Offline");
  });

  it("names one failure, several, and caps a long list", () => {
    expect(done(["A"], ["B"]).message).toBe(
      "Couldn't refresh B. Your previous copy is still on this device.",
    );
    expect(done(["A"], ["B", "C"]).message).toContain("B, C. Your previous copies are");

    const many = Array.from({ length: REFRESH_FAILURES_LISTED + 2 }, (_, i) => `M${i}`);
    const message = done([], many, true).message;
    expect(message.startsWith("The connection was lost.")).toBe(true);
    expect(message).toContain(`M${REFRESH_FAILURES_LISTED - 1} and 2 more`);
    expect(message).not.toContain(`M${REFRESH_FAILURES_LISTED},`);
  });
});
