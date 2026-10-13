import { clubMeetsNewestFirst, formatClubMeetDate } from "@/lib/club-meets";
import type { AthleteClub } from "@/types/club";

const entry = (meet: string, meet_date?: string | null): AthleteClub => ({ member_id: "1", name: "Al", club: "Club", meet, meet_date });

describe("clubMeetsNewestFirst (#341)", () => {
  it("puts the newest meet first, undated meets after by the year they are named for", () => {
    const meets = clubMeetsNewestFirst([
      entry("2023 American Open Finals", "2023-12-01"),
      entry("Arnold", null),
      entry("2026 USA Masters Nationals", "2026-03-27"),
      entry("2026 USA Masters Nationals", "2026-03-27"),
      entry("2025 Howard Cohen", "2025-12-11"),
      entry("2024 Club Meet"),
      entry("2025 Club Meet", null),
    ]);
    expect(meets).toEqual([
      { meet: "2026 USA Masters Nationals", date: "2026-03-27" },
      { meet: "2025 Howard Cohen", date: "2025-12-11" },
      { meet: "2023 American Open Finals", date: "2023-12-01" },
      { meet: "2025 Club Meet", date: null },
      { meet: "2024 Club Meet", date: null },
      { meet: "Arnold", date: null },
    ]);
  });

  it("ignores a date that is not a calendar date, and takes one any entry of the meet has", () => {
    expect(clubMeetsNewestFirst([entry("A", "2026-02-30"), entry("B", null), entry("B", "2024-01-01")])).toEqual([
      { meet: "B", date: "2024-01-01" },
      { meet: "A", date: null },
    ]);
  });

  it("formats the meet's calendar date, not the device's day", () => {
    expect(formatClubMeetDate("2026-03-27")).toBe("Mar 27, 2026");
    expect(formatClubMeetDate(null)).toBeNull();
    expect(formatClubMeetDate("TBD")).toBeNull();
  });
});
