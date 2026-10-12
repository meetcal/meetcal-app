import { describeSaveSessionsFailure } from "@/lib/saved-sessions-actions";

jest.mock("@/lib/posthog", () => ({ posthog: { capture: jest.fn() } }));
jest.mock("@/lib/database/queries", () => ({ fetchSchedule: jest.fn() }));
jest.mock("@/lib/database/offline-store", () => ({ getMeetData: jest.fn() }));

describe("describeSaveSessionsFailure", () => {
  it("is null when every session was saved", () => {
    expect(describeSaveSessionsFailure({ total: 3, saved: 3 })).toBeNull();
  });

  it("says Saved N of M for a partial save", () => {
    expect(describeSaveSessionsFailure({ total: 12, saved: 11 })).toBe(
      "Saved 11 of 12 sessions. The rest could not be saved.",
    );
  });

  it("reports a total failure and an empty batch", () => {
    expect(describeSaveSessionsFailure({ total: 3, saved: 0 })).toBe("Failed to save sessions.");
    expect(describeSaveSessionsFailure({ total: 0, saved: 0 })).toBe(
      "There are no sessions to save.",
    );
  });
});
