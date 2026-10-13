/**
 * The meet package's schedule and `/meets/schedule` describe the same rows;
 * once mapped by the app they must be the same `Schedule`. The package used
 * to keep only each session's first row's times, so a downloaded meet put a
 * 9:30 Blue session at Red's 9:00 (offline schedule, reminders, widget).
 */
import { packageSchedule } from '../convex/lib/meetData';
import { mapApiSchedule, mapPackageSchedule, type ApiMeetPackage } from '../src/lib/api/meetcal-api';

// In the order both queries return them: date, session, platform.
const rows = [
  { date: '2026-10-10', meet: 'Test Meet', platform: 'Blue', session_id: 3, start_time: '09:30:00', weigh_in_time: '07:30:00', weight_class: '65kg' },
  { date: '2026-10-10', meet: 'Test Meet', platform: 'Red', session_id: 3, start_time: '09:00:00', weigh_in_time: '07:00:00', weight_class: '60kg' },
  { date: '2026-10-10', meet: 'Test Meet', platform: 'Red', session_id: 4, start_time: '11:00:00', weigh_in_time: '09:00:00', weight_class: '71kg' },
];

function packageWith(schedule: ApiMeetPackage['schedule']): ApiMeetPackage {
  return {
    meet: { name: 'Test Meet' },
    schedule,
    athletes: [],
    meet_results: [],
    attempt_estimates: [],
    year_bests_by_name: {},
    recent_results_by_name: {},
  } as unknown as ApiMeetPackage;
}

describe('package schedule', () => {
  it('maps to the same schedule as /meets/schedule, each platform at its own time', () => {
    const fromPackage = mapPackageSchedule(packageWith(packageSchedule(rows as never)));

    expect(fromPackage).toEqual(mapApiSchedule(rows));
    const session3 = fromPackage[0].sessions.find((s) => s.number === 3);
    expect(session3?.platforms.map((p) => [p.platform, p.platformStartTime])).toEqual([
      ['Blue', '9:30 AM'],
      ['Red', '9:00 AM'],
    ]);
  });

  it("falls back to the session's times for a package built before platforms had their own", () => {
    const legacy = packageSchedule(rows as never).map((day) => ({
      ...day,
      sessions: day.sessions.map((session) => ({
        ...session,
        platforms: session.platforms.map(({ platform, weight_class }) => ({ platform, weight_class })),
      })),
    }));

    const fromPackage = mapPackageSchedule(packageWith(legacy));

    const session3 = fromPackage[0].sessions.find((s) => s.number === 3);
    expect(session3?.platforms.every((p) => p.platformStartTime === session3.platforms[0].platformStartTime)).toBe(true);
  });
});
