import AsyncStorage from "@react-native-async-storage/async-storage";

import type { LiftResult } from "@/data/types/athletes";
import type { Schedule } from "@/types/schedule";
import { clearMeetData } from "@/lib/database/meet-data-clears";
import { markMeetAthletesCurrent, saveMeetAthletes, saveMeetSchedule } from "@/lib/database/meet-data-saves";
import { getMeetAthletesSyncedAt, getMeetAthletesTag } from "@/lib/database/offline-store-index";

let mockBundle = "update-1:42:3.0.0";
jest.mock("@/lib/database/persisted-tag", () => {
  const actual = jest.requireActual("@/lib/database/persisted-tag");
  return {
    ...actual,
    encodePersistedTag: (tag: string | null | undefined) => actual.encodePersistedTag(tag, mockBundle),
    decodePersistedTag: (stored: unknown) => actual.decodePersistedTag(stored, mockBundle),
  };
});

const MEET = "Tagged Meet";
const athlete = (name: string): LiftResult =>
  ({ name, session: { number: 1, platform: "Red" } }) as unknown as LiftResult;
const schedule: Schedule = [
  {
    date: "Saturday",
    fullDate: "2099-01-01",
    sessions: [{ id: "1", number: 1, startTime: "8:00 AM", weighInTime: "6:00 AM", platforms: [] }],
  },
] as unknown as Schedule;

beforeEach(async () => {
  await AsyncStorage.clear();
  mockBundle = "update-1:42:3.0.0";
});

describe("the roster's tag", () => {
  it("is kept with the stored roster and read back after a restart", async () => {
    await saveMeetAthletes(MEET, [athlete("A Lifter")], '"r1"');
    await expect(getMeetAthletesTag(MEET)).resolves.toBe('"r1"');
  });

  it("is replaced by the next roster's tag, and dropped by a roster stored without one", async () => {
    await saveMeetAthletes(MEET, [athlete("A Lifter")], '"r1"');
    await saveMeetAthletes(MEET, [athlete("B Lifter")], '"r2"');
    await expect(getMeetAthletesTag(MEET)).resolves.toBe('"r2"');
    await saveMeetAthletes(MEET, [athlete("C Lifter")]);
    await expect(getMeetAthletesTag(MEET)).resolves.toBeNull();
  });

  it("is not stored for an empty answer the store refuses over a saved roster", async () => {
    await saveMeetAthletes(MEET, [athlete("A Lifter")], '"r1"');
    await expect(saveMeetAthletes(MEET, [], '"empty"')).resolves.toBe(false);
    await expect(getMeetAthletesTag(MEET)).resolves.toBe('"r1"');
  });

  it("survives a schedule write to the same meet", async () => {
    await saveMeetAthletes(MEET, [athlete("A Lifter")], '"r1"');
    await saveMeetSchedule(MEET, schedule);
    await expect(getMeetAthletesTag(MEET)).resolves.toBe('"r1"');
  });

  it("goes with the meet's data on a clear", async () => {
    await saveMeetAthletes(MEET, [athlete("A Lifter")], '"r1"');
    await clearMeetData(MEET);
    await expect(getMeetAthletesTag(MEET)).resolves.toBeNull();
  });

  it("is not read by another app bundle", async () => {
    await saveMeetAthletes(MEET, [athlete("A Lifter")], '"r1"');
    mockBundle = "update-2:42:3.0.0";
    await expect(getMeetAthletesTag(MEET)).resolves.toBeNull();
  });

  it("is absent for a meet with no stored roster", async () => {
    await expect(getMeetAthletesTag("Unknown Meet")).resolves.toBeNull();
  });

  it("marks the stored roster current when the server says it is unchanged", async () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000);
    await saveMeetAthletes(MEET, [athlete("A Lifter")], '"r1"');
    now.mockReturnValue(5_000);
    await markMeetAthletesCurrent(MEET);
    await expect(getMeetAthletesSyncedAt(MEET)).resolves.toBe(5_000);
    await expect(getMeetAthletesTag(MEET)).resolves.toBe('"r1"');
    now.mockRestore();
  });

  it("marks nothing for a meet the store does not hold", async () => {
    await markMeetAthletesCurrent("Unknown Meet");
    await expect(getMeetAthletesSyncedAt("Unknown Meet")).resolves.toBe(0);
  });
});
