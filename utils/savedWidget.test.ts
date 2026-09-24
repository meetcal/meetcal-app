import { NativeModules } from "react-native";
import {
  capWidgetSessions,
  clearSavedWidget,
  MAX_WIDGET_SESSIONS,
  syncSavedWidget,
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

describe("capWidgetSessions", () => {
  it("passes an empty list straight through", () => {
    expect(capWidgetSessions([])).toEqual([]);
  });

  it("does not reorder a list that fits under the cap", () => {
    const sessions = [
      session({ id: "c", date: "2026-06-22", sessionNumber: 3 }),
      session({ id: "a", date: "2026-06-20", sessionNumber: 1 }),
      session({ id: "b", date: "2026-06-21", sessionNumber: 2 }),
    ];
    // Identity, not just equality: the widget must see exactly what it always
    // has when no truncation is needed.
    expect(capWidgetSessions(sessions)).toBe(sessions);
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
    expect(dates[0]).toBe(
      [...sessions].map((s) => s.date).sort()[0],
    );
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

  it("sends only the selected meet's sessions, each with its zone and a deep link", () => {
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
      time_zone: "America/Denver",
    });
    expect(String(rows[0].url)).toMatch(/^meetcal:\/\//);
  });

  it("sends an empty list when no meet is selected, so stale rows disappear", () => {
    syncSavedWidget(null, [session({ id: "a" })], "America/Denver");
    expect(updateSavedWidget).toHaveBeenCalledWith("", "[]");
  });

  it("falls back to UTC for a missing or unknown zone instead of passing it to the widget", () => {
    syncSavedWidget("Test Meet" as SavedSession["meet"], [session({ id: "a" })], "Mars/Olympus");
    expect(sentRows()[0].time_zone).toBe("UTC");
    syncSavedWidget("Test Meet" as SavedSession["meet"], [session({ id: "a" })]);
    expect(sentRows()[0].time_zone).toBe("UTC");
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
