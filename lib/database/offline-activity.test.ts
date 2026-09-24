import {
  claimOfflineBulk,
  claimOfflineItem,
  getOfflineActivity,
  releaseOfflineBulk,
  releaseOfflineItem,
  resetOfflineActivityForTests,
  subscribeOfflineActivity,
} from "@/lib/database/offline-activity";

beforeEach(() => {
  resetOfflineActivityForTests();
});

describe("offline activity", () => {
  it("lets one action hold a row and refuses a second claim until release", () => {
    expect(claimOfflineItem("standards")).toBe(true);
    expect(claimOfflineItem("standards")).toBe(false);
    expect(claimOfflineItem("records")).toBe(true);
    releaseOfflineItem("standards");
    expect(claimOfflineItem("standards")).toBe(true);
  });

  it("refuses a bulk action while a row runs and rows while a bulk action runs", () => {
    expect(claimOfflineItem("meet:A")).toBe(true);
    expect(claimOfflineBulk("delete")).toBe("items-running");
    releaseOfflineItem("meet:A");

    expect(claimOfflineBulk("refresh")).toBe("claimed");
    expect(claimOfflineBulk("delete")).toBe("bulk-running");
    expect(claimOfflineBulk("refresh")).toBe("bulk-running");
    expect(claimOfflineItem("meet:A")).toBe(false);
    releaseOfflineBulk("refresh");
    expect(claimOfflineBulk("delete")).toBe("claimed");
  });

  it("ignores a release by an action that does not hold the claim", () => {
    expect(claimOfflineBulk("refresh")).toBe("claimed");
    releaseOfflineBulk("delete");
    expect(getOfflineActivity().bulk).toBe("refresh");
    const before = getOfflineActivity();
    releaseOfflineItem("never-claimed");
    expect(getOfflineActivity()).toBe(before);
  });

  it("rejects an empty row id", () => {
    expect(() => claimOfflineItem("")).toThrow("empty item id");
  });

  it("notifies subscribers with a new snapshot and bumps settled on release", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeOfflineActivity(listener);
    const idle = getOfflineActivity();

    claimOfflineItem("records");
    const busy = getOfflineActivity();
    expect(busy).not.toBe(idle);
    expect(busy.settled).toBe(0);
    releaseOfflineItem("records");
    expect(getOfflineActivity().settled).toBe(1);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    claimOfflineBulk("delete");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
