import { findSessionPlatform } from '@/lib/schedule-lookup';
import type { Schedule } from '@/types/schedule';

const schedule: Schedule = [
  {
    date: 'Friday',
    fullDate: '2026-06-19',
    sessions: [
      {
        id: 's1',
        number: 1,
        startTime: '08:00',
        weighInTime: '06:00',
        platforms: [
          { platform: 'Red', weightClass: '60kg', platformStartTime: '08:00' },
          { platform: 'Blue', weightClass: '65kg', platformStartTime: '08:30' },
        ],
      },
    ],
  },
  {
    date: 'Saturday',
    fullDate: '2026-06-20',
    sessions: [
      {
        id: 's2',
        number: 2,
        startTime: '10:00',
        weighInTime: '08:00',
        platforms: [{ platform: 'Red', weightClass: '71kg' }],
      },
    ],
  },
];

describe('findSessionPlatform', () => {
  it("finds the session's day and its row for the platform", () => {
    const match = findSessionPlatform(schedule, 1, 'Blue');

    expect(match?.day.date).toBe('Friday');
    expect(match?.session.id).toBe('s1');
    expect(match?.platform).toEqual({
      platform: 'Blue',
      weightClass: '65kg',
      platformStartTime: '08:30',
    });
  });

  it('matches the platform name loosely, like every platform comparison', () => {
    expect(findSessionPlatform(schedule, 1, ' red ')?.platform?.weightClass).toBe('60kg');
  });

  it('still returns the day and session when the platform has no row', () => {
    const match = findSessionPlatform(schedule, 2, 'Blue');

    expect(match?.day.date).toBe('Saturday');
    expect(match?.session.number).toBe(2);
    expect(match?.platform).toBeNull();
  });

  it('is null for a session the schedule does not have', () => {
    expect(findSessionPlatform(schedule, 9, 'Red')).toBeNull();
    expect(findSessionPlatform([], 1, 'Red')).toBeNull();
    expect(findSessionPlatform(schedule, Number.NaN, 'Red')).toBeNull();
  });
});
