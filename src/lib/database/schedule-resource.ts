import type { MeetName } from "@/data/types/meet";
import { createMutableResource, defaultIsEqual } from "@/lib/data/mutable-resource";
import {
  clearMeetSchedule,
  getMeetSchedule,
  saveMeetSchedule,
} from "@/lib/database/offline-store";
import { fetchSchedule } from "@/lib/database/queries";
import type { Schedule } from "@/types/schedule";

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
    const schedule = await getMeetSchedule(meet);
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
    // `schedule.length > 0`. Explicit invalidation still goes through
    // `clearCached` below.
    if (data.length === 0) {
      return null;
    }

    await saveMeetSchedule(meet, data);
    return { data, lastUpdatedAt: Date.now() };
  },
  clearCached: async (meet) => {
    await clearMeetSchedule(meet);
  },
  isEqual: defaultIsEqual,
  // For the same reason, an empty answer is not pushed onto screens that are
  // showing a schedule; only the caller that asked for it sees it.
  isPublishable: (data) => data.length > 0,
});
