import { migrateSessionsToMeetSpecific } from "@/utils/migration";

describe("migrateSessionsToMeetSpecific", () => {
  const legacy = {
    id: "old-id",
    sessionNumber: 3,
    platform: "Red",
    weightClass: "71kg",
    startTime: "10:00 AM",
    weighInTime: "8:00 AM",
    date: "2026-06-20",
  };

  it("assigns the current meet and regenerates the id", () => {
    const [migrated] = migrateSessionsToMeetSpecific([legacy], "Test Meet");
    expect(migrated.meet).toBe("Test Meet");
    expect(migrated.id).not.toBe("old-id");
    expect(migrated.sessionNumber).toBe(3);
  });

  it("keeps an existing meet", () => {
    const [migrated] = migrateSessionsToMeetSpecific(
      [{ ...legacy, meet: "Other Meet" }],
      "Test Meet",
    );
    expect(migrated.meet).toBe("Other Meet");
  });

  it("skips null and non-object entries instead of throwing", () => {
    expect(() =>
      migrateSessionsToMeetSpecific([null, "row", [], legacy], "Test Meet"),
    ).not.toThrow();
    expect(migrateSessionsToMeetSpecific([null, "row", [], legacy], "Test Meet")).toHaveLength(1);
  });
});
