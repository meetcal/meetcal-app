import { findSessionPlatform, platformSessionTimes } from '@/lib/schedule-lookup';
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

// #281: one weigh-in rule for every screen.
describe('platformSessionTimes', () => {
  const session = { startTime: '9:00 AM', weighInTime: '7:00 AM' };

  it("uses the platform's own start and published weigh-in", () => {
    expect(
      platformSessionTimes(session, { platformStartTime: '9:30 AM', platformWeighInTime: '7:15 AM' }),
    ).toEqual({ startTime: '9:30 AM', weighInTime: '7:15 AM' });
  });

  it('computes start minus 2 h when the platform published none', () => {
    expect(
      platformSessionTimes(session, { platformStartTime: '9:30 AM', platformWeighInTime: '' }),
    ).toEqual({ startTime: '9:30 AM', weighInTime: '7:30 AM' });
  });

  it("uses a cached schedule's session weigh-in only for a platform starting with the session", () => {
    expect(platformSessionTimes(session, { platformStartTime: '9:00 AM' })).toEqual({
      startTime: '9:00 AM',
      weighInTime: '7:00 AM',
    });
    expect(platformSessionTimes(session, { platformStartTime: '9:30 AM' })).toEqual({
      startTime: '9:30 AM',
      weighInTime: '7:30 AM',
    });
    expect(platformSessionTimes(session, null)).toEqual({ startTime: '9:00 AM', weighInTime: '7:00 AM' });
  });

  it("keeps a platform untimed rather than giving it the first platform's start", () => {
    // Red published 9:00 (the session's start comes from its row); Blue has none.
    expect(
      platformSessionTimes(session, { platformStartTime: '', platformWeighInTime: '' }),
    ).toEqual({ startTime: '', weighInTime: '' });
  });

  it('is unknown for an untimed row', () => {
    expect(
      platformSessionTimes({ startTime: '', weighInTime: '' }, { platformStartTime: '', platformWeighInTime: '' }),
    ).toEqual({ startTime: '', weighInTime: '' });
  });
});
