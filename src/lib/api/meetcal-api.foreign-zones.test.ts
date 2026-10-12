/**
 * @jest-environment-options {"deviceTimeZone": "America/Los_Angeles"}
 */
// Meets outside the US, seen from a phone in Los Angeles: the usual reader of
// a foreign meet is a US lifter travelling to it or following it from home.
// The docblock pins the device zone before the file loads
// (jest/device-timezone-environment.js); `meetcal-api.test.ts` covers a
// device east of every meet.
import { convertToUTC } from '@/data/meets/config';
import { selectNextSession } from '@/lib/next-session';
import { mapApiMeet, mapApiSchedule, type ApiMeet } from '@/lib/api/meetcal-api';

function apiMeet(timeZone: string, start: string, end = start): ApiMeet {
  return {
    name: 'Abroad Open',
    status: 'upcoming',
    start_date: start,
    end_date: end,
    time_zone: timeZone,
    venue_name: 'Hall',
    venue_street: '1 Main',
    venue_city: 'City',
    venue_state: '',
    venue_zip: '',
  };
}

describe('a meet in a zone outside the US', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('runs on a US device zone', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Los_Angeles');
  });

  it.each([
    // zone, start date, offset (hours west of UTC), label
    ['Asia/Tokyo', '2026-06-20', -9, 'GMT+9'],
    ['Asia/Kolkata', '2026-06-20', -5.5, 'GMT+5:30'],
    ['Australia/Sydney', '2026-01-15', -11, 'GMT+11'],
    ['Australia/Sydney', '2026-07-15', -10, 'GMT+10'],
    ['Pacific/Auckland', '2026-01-15', -13, 'GMT+13'],
    ['Europe/Madrid', '2026-06-20', -2, 'GMT+2'],
    ['Europe/London', '2026-01-15', 0, 'GMT'],
    ['America/Puerto_Rico', '2026-06-20', 4, 'AST'],
  ])('keeps %s (meet starting %s) as its own zone', (zone, start, utcOffset, abbreviation) => {
    const meet = mapApiMeet(apiMeet(zone, start));

    expect(meet.timeZoneUnknown).toBe(false);
    expect(meet.time.timeZoneIdentifier).toBe(zone);
    expect(meet.time.utcOffset).toBe(utcOffset);
    expect(meet.time.abbreviation).toBe(abbreviation);
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads the offset on the meet date in the meet zone, not at a fixed UTC hour', () => {
    // Auckland moves its clocks back at 3:00 on 5 April 2026. 16:00 UTC on
    // the 4th (the old probe) is already 5:00 on the 5th there, so a meet
    // starting on the 4th was labelled with the next day's standard time.
    const meet = mapApiMeet(apiMeet('Pacific/Auckland', '2026-04-04'));
    expect(meet.time.abbreviation).toBe('GMT+13');
    expect(meet.time.utcOffset).toBe(-13);
  });

  it('falls back loudly for a blank zone, as before', () => {
    const meet = mapApiMeet(apiMeet('', '2026-06-20'));
    expect(meet.timeZoneUnknown).toBe(true);
    expect(meet.time.timeZoneIdentifier).toBe('America/New_York');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown meet time zone'));
  });

  it('falls back loudly for a zone the device cannot read', () => {
    const meet = mapApiMeet(apiMeet('Asia/Atlantis', '2026-06-20'));
    expect(meet.timeZoneUnknown).toBe(true);
    expect(meet.time.timeZoneIdentifier).toBe('America/New_York');
    expect(meet.time.timeZone).toBe('Asia/Atlantis');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"Asia/Atlantis"'));
  });

  it('titles schedule days with their own date, east of UTC+12 too', () => {
    // Noon UTC read in Auckland is already the next day, which is what the
    // day titles showed when they were formatted in the meet's zone.
    const row = {
      meet: 'Abroad Open',
      platform: 'Red',
      session_id: 1,
      start_time: '09:00:00',
      weigh_in_time: '07:00:00',
      weight_class: '60kg',
    };
    const schedule = mapApiSchedule([
      { ...row, date: '2026-01-15' },
      { ...row, date: '2026-01-16', session_id: 2 },
    ]);
    expect(schedule.map((day) => [day.date, day.fullDate])).toEqual([
      ['January 15, 2026', '2026-01-15'],
      ['January 16, 2026', '2026-01-16'],
    ]);
  });

  it('turns a session time into the instant it happens at the meet', () => {
    const tokyo = mapApiMeet(apiMeet('Asia/Tokyo', '2026-06-20'));
    // 9:00 AM in Tokyo on 20 June is 5:00 PM on 19 June in Los Angeles.
    expect(convertToUTC('9:00 AM', '2026-06-20', tokyo.time.timeZoneIdentifier).toISOString()).toBe(
      '2026-06-20T00:00:00.000Z',
    );
    const kolkata = mapApiMeet(apiMeet('Asia/Kolkata', '2026-06-20'));
    expect(convertToUTC('10:00 AM', '2026-06-20', kolkata.time.timeZoneIdentifier).toISOString()).toBe(
      '2026-06-20T04:30:00.000Z',
    );
  });

  it("picks the next session by the meet's date, a day ahead of this device's", () => {
    const meet = mapApiMeet(apiMeet('Asia/Tokyo', '2026-06-20', '2026-06-21'));
    const session = {
      id: 's1',
      meet: 'Abroad Open',
      sessionNumber: 1,
      platform: 'Red',
      weightClass: '60kg',
      startTime: '9:00 AM',
      weighInTime: '7:00 AM',
      date: '2026-06-20',
    };
    // 4:00 PM on 19 June in Los Angeles, 8:00 AM on 20 June in Tokyo: the
    // meet is under way there though it has not started on this calendar.
    const now = new Date('2026-06-19T23:00:00Z');
    const next = selectNextSession([session], 'Abroad Open', meet, now);
    expect(next?.startMs).toBe(Date.parse('2026-06-20T00:00:00Z'));
  });
});
