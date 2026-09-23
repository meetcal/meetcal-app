import { selectDownloadableMeets } from "@/utils/offline";

// The hook body pulls in Clerk/RevenueCat contexts and AsyncStorage; only the
// pure window selector is under test here.
jest.mock("@/contexts/SelectedMeetContext", () => ({ useSelectedMeet: jest.fn() }));
jest.mock("@/contexts/SubscriptionContext", () => ({ useSubscription: jest.fn() }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const meet = (start: string, end: string) => ({ dates: { start, end } });

describe("selectDownloadableMeets", () => {
  const today = "2026-06-20";

  it("returns nothing for an empty list", () => {
    expect(selectDownloadableMeets([], today)).toEqual([]);
  });

  it("includes a meet starting today", () => {
    expect(selectDownloadableMeets([meet(today, today)], today)).toHaveLength(1);
  });

  it("includes a meet ending today even though it started before", () => {
    expect(
      selectDownloadableMeets([meet("2026-06-18", today)], today),
    ).toHaveLength(1);
  });

  it("excludes a meet that finished yesterday", () => {
    expect(
      selectDownloadableMeets([meet("2026-06-17", "2026-06-19")], today),
    ).toEqual([]);
  });

  it("includes the last day of the 21-day window and excludes the day after", () => {
    expect(
      selectDownloadableMeets([meet("2026-07-11", "2026-07-12")], today),
    ).toHaveLength(1);
    expect(
      selectDownloadableMeets([meet("2026-07-12", "2026-07-13")], today),
    ).toEqual([]);
  });

  it("crosses a month boundary without drifting a day", () => {
    // `new Date("2026-07-01T00:00:00")` is local midnight, and the old
    // comparison mixed that with a local `startOfToday`; the string window is
    // timezone-independent.
    expect(
      selectDownloadableMeets([meet("2026-07-01", "2026-07-03")], "2026-06-30"),
    ).toHaveLength(1);
  });

  it("drops meets with a missing or malformed date", () => {
    expect(
      selectDownloadableMeets(
        [
          { dates: { start: "", end: "2026-06-21" } },
          { dates: { start: "2026-06-20", end: "" } },
          { dates: { start: "June 20 2026", end: "June 21 2026" } },
          {},
        ],
        today,
      ),
    ).toEqual([]);
  });
});
