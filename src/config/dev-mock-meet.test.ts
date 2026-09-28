import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getMockAthletesWithSession,
  getMockedMeet,
  getMockSchedule,
  isMockedMeet,
} from "@/config/dev-mock-meet";

const MEET = "Mock Meet";

describe("dev mock meet hydration", () => {
  // Relies on module state being unhydrated: no other test in this file
  // exercises the hydration-backed reads, so the first call here starts fresh.
  it("resolves concurrent reads to the persisted meet (no hydration race)", async () => {
    await AsyncStorage.setItem("@dev_mock_meet", "Race Meet");

    // Fire two reads concurrently before the AsyncStorage read settles. The
    // second call must await the in-flight hydration rather than short-circuit
    // on a not-yet-populated value.
    const [mocked, isMocked] = await Promise.all([
      getMockedMeet(),
      isMockedMeet("Race Meet"),
    ]);

    expect(mocked).toBe("Race Meet");
    expect(isMocked).toBe(true);
  });
});

describe("getMockSchedule", () => {
  it("builds 3 days of sessions with sequential session numbers", () => {
    const schedule = getMockSchedule(MEET);

    expect(schedule).toHaveLength(3);

    const numbers = schedule.flatMap((day) =>
      day.sessions.map((s) => s.number),
    );
    // 3 days x 3 daily session times = 9 sequential sessions.
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    schedule.forEach((day) => {
      expect(day.sessions).toHaveLength(3);
      expect(day.fullDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});

describe("getMockAthletesWithSession", () => {
  it("filters by session number and platform", () => {
    const filtered = getMockAthletesWithSession(MEET, 1, "Red");

    expect(filtered.length).toBeGreaterThan(0);
    filtered.forEach((athlete) => {
      expect(athlete.session?.number).toBe(1);
      expect(athlete.session?.platform).toBe("Red");
    });
  });

  it("returns every generated athlete when no filters are given", () => {
    const all = getMockAthletesWithSession(MEET);
    const forSession1 = getMockAthletesWithSession(MEET, 1);

    expect(all.length).toBeGreaterThan(forSession1.length);
    forSession1.forEach((athlete) => {
      expect(athlete.session?.number).toBe(1);
    });
  });
});
