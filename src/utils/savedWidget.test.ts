/**
 * @jest-environment-options {"deviceTimeZone": "America/New_York"}
 */
import { NativeModules } from "react-native";
import {
  buildSavedWidgetRows,
  capWidgetSessions,
  clearSavedWidget,
  formatWidgetDayLabel,
  MAX_WIDGET_SESSIONS,
  syncSavedWidget,
  widgetSessionStartAtMs,
} from "@/utils/savedWidget";
import type { SavedSession } from "@/hooks/useSavedSessions";

function session(
  overrides: Partial<SavedSession> & { id: string },
): SavedSession {
  return {
    meet: "Test Meet" as SavedSession["meet"],
    sessionNumber: 1,
    platform: "Red",
    weightClass: "89kg",
    startTime: "9:00 AM",
    weighInTime: "7:00 AM",
    date: "2026-06-20",
    ...overrides,
  };
}

it("runs on a US device zone, west of the Pacific meet zone used below", () => {
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/New_York");
});

describe("capWidgetSessions", () => {
  it("passes an empty list straight through", () => {
    expect(capWidgetSessions([])).toEqual([]);
  });

  it("orders by date and start time, not save order", () => {
    // Saved in this order: session 12 first, then the earlier session 2.
    const sessions = [
      session({ id: "s12", date: "2026-06-21", startTime: "9:00 AM", sessionNumber: 12 }),
      session({ id: "s2-late", date: "2026-06-20", startTime: "2:00 PM", sessionNumber: 3 }),
      session({ id: "s2", date: "2026-06-20", startTime: "9:00 AM", sessionNumber: 2 }),
    ];
    expect(capWidgetSessions(sessions).map((s) => s.id)).toEqual(["s2", "s2-late", "s12"]);
  });

  it("compares clock times numerically, so 10:00 AM follows 9:00 AM", () => {
    const sessions = [
      session({ id: "ten", startTime: "10:00 AM" }),
      session({ id: "pm", startTime: "1:30 PM" }),
      session({ id: "nine", startTime: "9:00 AM" }),
    ];
    expect(capWidgetSessions(sessions).map((s) => s.id)).toEqual(["nine", "ten", "pm"]);
  });

  it("breaks ties by session number then platform, and puts undated or untimed rows last", () => {
    const sessions = [
      session({ id: "undated", date: "" }),
      session({ id: "untimed", startTime: "" }),
      session({ id: "white", sessionNumber: 4, platform: "White" }),
      session({ id: "red", sessionNumber: 4, platform: "Red" }),
      session({ id: "three", sessionNumber: 3 }),
    ];
    expect(capWidgetSessions(sessions).map((s) => s.id)).toEqual([
      "three",
      "red",
      "white",
      "untimed",
      "undated",
    ]);
  });

  it("puts an untimed row after timed rows on later dates", () => {
    // Untimed rows have no start instant, so the widget never drops them; an
    // earlier-dated one must not sit above the next real session.
    const sessions = [
      session({ id: "untimed-19", date: "2026-06-19", startTime: "" }),
      session({ id: "bad-time-18", date: "2026-06-18", startTime: "TBD" }),
      session({ id: "timed-21", date: "2026-06-21", startTime: "9:00 AM" }),
      session({ id: "timed-20", date: "2026-06-20", startTime: "9:00 AM" }),
      session({ id: "undated", date: "" }),
    ];
    expect(capWidgetSessions(sessions).map((s) => s.id)).toEqual([
      "timed-20",
      "timed-21",
      "bad-time-18",
      "untimed-19",
      "undated",
    ]);
  });

  it("does not mutate the caller's list", () => {
    const sessions = [
      session({ id: "b", date: "2026-06-21" }),
      session({ id: "a", date: "2026-06-20" }),
    ];
    capWidgetSessions(sessions);
    expect(sessions.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("keeps the earliest sessions when the list exceeds the cap", () => {
    const sessions = Array.from({ length: MAX_WIDGET_SESSIONS + 5 }, (_, i) =>
      session({
        id: `s${i}`,
        // Reverse chronological input, so a naive slice would keep the latest.
        date: `2026-06-${String(30 - (i % 30)).padStart(2, "0")}`,
        sessionNumber: MAX_WIDGET_SESSIONS + 5 - i,
      }),
    );

    const capped = capWidgetSessions(sessions);

    expect(capped).toHaveLength(MAX_WIDGET_SESSIONS);
    const dates = capped.map((s) => s.date);
    expect([...dates].sort()).toEqual(dates);
    expect(dates[0]).toBe([...sessions].map((s) => s.date).sort()[0]);
  });
});

describe("widgetSessionStartAtMs", () => {
  it("reads the wall-clock time in the meet's zone, not the device's", () => {
    // 9:00 AM in Los Angeles (PDT, UTC-7) is 16:00 UTC, whatever the device zone.
    expect(widgetSessionStartAtMs(session({ id: "a" }), "America/Los_Angeles")).toBe(
      Date.UTC(2026, 5, 20, 16, 0),
    );
  });

  it("is undefined without a zone, so the widget keeps the row", () => {
    expect(widgetSessionStartAtMs(session({ id: "a" }), null)).toBeUndefined();
  });

  it("is undefined for a time or date that does not convert", () => {
    expect(
      widgetSessionStartAtMs(session({ id: "a", startTime: "TBD" }), "America/Denver"),
    ).toBeUndefined();
    expect(
      widgetSessionStartAtMs(session({ id: "a", date: "2026-02-30" }), "America/Denver"),
    ).toBeUndefined();
    expect(
      widgetSessionStartAtMs(session({ id: "a", startTime: "" }), "America/Denver"),
    ).toBeUndefined();
  });
});

describe("formatWidgetDayLabel", () => {
  it("formats the calendar date without shifting it through the device zone", () => {
    // 2026-06-20 is a Saturday. Parsed as local time west of UTC it would read Friday.
    expect(formatWidgetDayLabel("2026-06-20")).toBe("Sat, Jun 20");
  });

  it("is undefined for a missing or malformed date", () => {
    expect(formatWidgetDayLabel(undefined)).toBeUndefined();
    expect(formatWidgetDayLabel("")).toBeUndefined();
    expect(formatWidgetDayLabel("June 20")).toBeUndefined();
    expect(formatWidgetDayLabel("2026-13-01")).toBeUndefined();
    // Rejected, not rolled over to "Mon, Mar 2".
    expect(formatWidgetDayLabel("2026-02-30")).toBeUndefined();
    expect(formatWidgetDayLabel("2028-02-29")).toBe("Tue, Feb 29");
  });
});

describe("buildSavedWidgetRows", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("sends the start instant, day label and zone when the zone resolves", () => {
    const [row] = buildSavedWidgetRows([session({ id: "a" })], "America/Los_Angeles");
    expect(row).toMatchObject({
      start_time: "9:00 AM",
      start_at_ms: Date.UTC(2026, 5, 20, 16, 0),
      day_label: "Sat, Jun 20",
      time_zone: "America/Los_Angeles",
    });
  });

  it("omits the start instant and zone for a missing or unknown zone instead of assuming UTC", () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    for (const zone of [undefined, "", "Mars/Olympus"]) {
      const [row] = buildSavedWidgetRows([session({ id: "a" })], zone);
      expect(row).not.toHaveProperty("start_at_ms");
      expect(row).not.toHaveProperty("time_zone");
      // The display fields still go through.
      expect(row).toMatchObject({ start_time: "9:00 AM", day_label: "Sat, Jun 20" });
    }
  });
});

describe("syncSavedWidget", () => {
  const updateSavedWidget = jest.fn();
  const clearNative = jest.fn();

  beforeEach(() => {
    updateSavedWidget.mockReset();
    clearNative.mockReset();
    NativeModules.SavedWidget = { updateSavedWidget, clearSavedWidget: clearNative };
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    delete NativeModules.SavedWidget;
    jest.restoreAllMocks();
  });

  function sentRows(): Record<string, unknown>[] {
    const [, json] = updateSavedWidget.mock.calls.at(-1) as [string, string];
    return JSON.parse(json);
  }

  it("sends only the selected meet's sessions, each with its start instant and a deep link", () => {
    syncSavedWidget(
      "Test Meet" as SavedSession["meet"],
      [
        session({ id: "mine", sessionNumber: 4 }),
        session({ id: "other", meet: "Other Meet" as SavedSession["meet"] }),
      ],
      "America/Denver",
    );

    expect(updateSavedWidget.mock.calls[0][0]).toBe("Test Meet");
    const rows = sentRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "mine",
      session_number: 4,
      date: "2026-06-20",
      start_time: "9:00 AM",
      // 9:00 AM MDT (UTC-6).
      start_at_ms: Date.UTC(2026, 5, 20, 15, 0),
      time_zone: "America/Denver",
    });
    expect(String(rows[0].url)).toMatch(/^meetcal:\/\//);
  });

  it("sends the rows in chronological order", () => {
    syncSavedWidget(
      "Test Meet" as SavedSession["meet"],
      [
        session({ id: "later", date: "2026-06-21" }),
        session({ id: "sooner", date: "2026-06-20" }),
      ],
      "America/Denver",
    );
    expect(sentRows().map((row) => row.id)).toEqual(["sooner", "later"]);
  });

  it("sends an empty list when no meet is selected, so stale rows disappear", () => {
    syncSavedWidget(null, [session({ id: "a" })], "America/Denver");
    expect(updateSavedWidget).toHaveBeenCalledWith("", "[]");
  });

  it("sends exactly the cap at the cap and truncates at cap + 1", () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, i) => session({ id: `s${i}`, sessionNumber: i + 1 }));

    syncSavedWidget("Test Meet" as SavedSession["meet"], many(MAX_WIDGET_SESSIONS), "UTC");
    expect(sentRows()).toHaveLength(MAX_WIDGET_SESSIONS);

    syncSavedWidget("Test Meet" as SavedSession["meet"], many(MAX_WIDGET_SESSIONS + 1), "UTC");
    const rows = sentRows();
    expect(rows).toHaveLength(MAX_WIDGET_SESSIONS);
    expect(rows.map((row) => row.id)).not.toContain(`s${MAX_WIDGET_SESSIONS}`);
  });

  it("does not throw when the native module is missing or fails", () => {
    updateSavedWidget.mockImplementation(() => {
      throw new Error("app group unavailable");
    });
    clearNative.mockImplementation(() => {
      throw new Error("app group unavailable");
    });
    expect(() => syncSavedWidget("Test Meet" as SavedSession["meet"], [session({ id: "a" })], "UTC")).not.toThrow();
    expect(() => clearSavedWidget()).not.toThrow();

    delete NativeModules.SavedWidget;
    expect(() => syncSavedWidget("Test Meet" as SavedSession["meet"], [], "UTC")).not.toThrow();
    expect(() => clearSavedWidget()).not.toThrow();
  });
});
