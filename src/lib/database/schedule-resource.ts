import type { MeetName } from "@/data/types/meet";
import { createMutableResource, defaultIsEqual } from "@/lib/data/mutable-resource";
import {
  getMeetSchedule,
  getMeetWriteGeneration,
  saveMeetSchedule,
} from "@/lib/database/offline-store";
import { fetchSchedule } from "@/lib/database/queries";
import type { Schedule } from "@/types/schedule";

/**
 * How long a primed schedule read (`primeScheduleCache`) may be handed out.
 * Long enough for the Schedule tab to mount after the meets list paints on a
 * slow device; short enough that nothing later reads it as current.
 */
export const SCHEDULE_PRIME_TTL_MS = 10_000;

type SchedulePrime = {
  meet: string;
  /** `getMeetWriteGeneration` when the read started. */
  generation: number;
  startedAt: number;
  read: Promise<Schedule>;
};

let schedulePrime: SchedulePrime | null = null;

/**
 * Starts reading a meet's stored schedule now, for the resource's next cache
 * read of that meet to use. A launch knows the stored meet as soon as it has
 * read one AsyncStorage key, while the Schedule tab asks for the schedule
 * only once the meets list has been read, chosen from and rendered: this
 * runs the two reads side by side instead of one after the other. One prime
 * at a time; a new one replaces the last.
 */
export function primeScheduleCache(meet: string, now: number = Date.now()): void {
  const read = getMeetSchedule(meet);
  // Not every prime is used (the app may open on another meet).
  read.catch(() => undefined);
  schedulePrime = { meet, generation: getMeetWriteGeneration(meet), startedAt: now, read };
}

/** Forgets the primed read. For tests. */
export function resetSchedulePrimeForTests(): void {
  schedulePrime = null;
}

/** The prime for `meet` if it may be used now, else null (and it is dropped). */
function currentPrime(meet: string, now: number): SchedulePrime | null {
  const prime = schedulePrime;
  if (!prime || prime.meet !== meet) return null;
  const age = now - prime.startedAt;
  if (age < 0 || age > SCHEDULE_PRIME_TTL_MS || prime.generation !== getMeetWriteGeneration(meet)) {
    schedulePrime = null;
    return null;
  }
  return prime;
}

/**
 * The primed schedule, or null when it cannot be trusted: a write to the
 * meet was queued or landed while it was read (checked once the read is
 * done), so it may be the copy from before the write.
 */
async function readPrime(prime: SchedulePrime): Promise<Schedule | null> {
  const schedule = await prime.read.catch(() => null);
  if (schedule === null || prime.generation !== getMeetWriteGeneration(prime.meet)) return null;
  return schedule;
}

/**
 * A meet's schedule: the offline copy first, then the API. Every screen
 * reads it through `useScheduleData`, and the background `SyncManager`
 * revalidates it, so a schedule change reaches every mounted copy (the
 * Schedule tab, the Saved tab, and through `useSavedSessions` the reminders
 * and the widget) together.
 */
export const scheduleResource = createMutableResource<Schedule, [MeetName]>({
  getKey: (meet) => `schedule:${meet}`,
  loadCached: async (meet) => {
    // On a launch the stored meet's schedule is already being read
    // (`SelectedMeetContext` primes it alongside the meets list). A network
    // answer published meanwhile still wins in `useMutableResource`, exactly
    // as over a slower disk read.
    const prime = currentPrime(meet, Date.now());
    const schedule =
      (prime && (await readPrime(prime))) || (await getMeetSchedule(meet));
    if (schedule.length === 0) {
      return null;
    }
    return {
      data: schedule,
      lastUpdatedAt: null,
    };
  },
  fetchFresh: (meet) => fetchSchedule(meet),
  persistFresh: async (data, meet) => {
    // An empty response is not a command to delete the offline copy. This used
    // to call `clearMeetSchedule(meet)`, so one `200 []` from
    // `/meets/schedule` — rows briefly unpublished, a re-import, a backend
    // filter bug — permanently destroyed a schedule the user had explicitly
    // downloaded for offline use, and the next launch in airplane mode had
    // nothing to fall back on. Every other writer takes the opposite stance
    // for the same payload: `saveMeetSchedule` rejects an empty schedule
    // outright, and both prefetch paths in `meet-manager` guard on
    // `schedule.length > 0`.
    if (data.length === 0) {
      return null;
    }

    await saveMeetSchedule(meet, data);
    return { data, lastUpdatedAt: Date.now() };
  },
  isEqual: defaultIsEqual,
  // For the same reason, an empty answer is not pushed onto screens that are
  // showing a schedule; only the caller that asked for it sees it.
  isPublishable: (data) => data.length > 0,
});
