import { capWidgetSessions, MAX_WIDGET_SESSIONS } from "@/utils/savedWidget";
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
