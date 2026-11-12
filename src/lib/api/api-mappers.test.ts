import { clearHttpValidatorCache } from '@/lib/api/revalidated-reads';
import { formatApiTime, mapApiMeet, mapApiSchedule, mapPackageSchedule, normalizePlatform } from '@/lib/api/api-meet-mappers';
import { mapApiAthlete, mapApiAthletes, mapApiLiftingResult, mapApiYearBests } from '@/lib/api/api-athlete-mappers';
import { resetServerClockForTests } from '@/lib/api/server-clock';
import { setApiTransportForTests } from './transport';
import { UNKNOWN_PLATFORM } from '@/data/types/athletes';
import { generateSessionId } from '@/utils/session';

beforeEach(() => {
  resetServerClockForTests();
  clearHttpValidatorCache();
  jest.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  setApiTransportForTests(null);
  resetServerClockForTests();
  clearHttpValidatorCache();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('meetcal API mappers', () => {
  it('maps meet, schedule, athlete, result, and best rows into app shapes', () => {
    const meet = mapApiMeet({
      id: 'meet-1',
      name: 'Test Meet',
      federation: 'USAW',
      status: 'upcoming',
      start_date: '2026-06-20',
      end_date: '2026-06-21',
      time_zone: 'America/New_York',
      venue_name: 'Test Venue',
      venue_street: '1 Main',
      venue_city: 'Columbus',
      venue_state: 'OH',
      venue_zip: '43215',
    });

    expect(meet.name).toBe('Test Meet');
    expect(meet.venue.address.state).toBe('OH');
    expect(meet.time.timeZoneIdentifier).toBe('America/New_York');

    const schedule = mapApiSchedule([
      {
        date: '2026-06-20',
        meet: 'Test Meet',
        platform: 'blue',
        session_id: 2,
        start_time: '13:30:00',
        weigh_in_time: '11:30:00',
        weight_class: '73kg',
      },
    ]);

    expect(schedule[0].sessions[0].number).toBe(2);
    expect(schedule[0].sessions[0].startTime).toBe('1:30 PM');
    expect(schedule[0].sessions[0].platforms[0]).toEqual({
      platform: 'Blue',
      weightClass: '73kg',
      platformStartTime: '1:30 PM',
      platformWeighInTime: '11:30 AM',
    });

    const athlete = mapApiAthlete({
      member_id: '123',
      adaptive: false,
      age: 24,
      club: 'Club',
      entry_total: 250,
      gender: 'Men',
      meet: 'Test Meet',
      name: 'Athlete A',
      session_number: 2,
      session_platform: 'Blue',
      weight_class: '73kg',
      wso: null,
    });

    expect(athlete).toMatchObject({
      memberId: '123',
      entryTotal: 250,
      session: { number: 2, platform: 'Blue' },
    });

    expect(mapApiLiftingResult({
      id: 10,
      event_id: 'event-1',
      federation: 'USAW',
      meet: 'Test Meet',
      date: '2026-06-20',
      name: 'Athlete A',
      age: 'Open Men 73kg',
      body_weight: 72.5,
      snatch1: 100,
      snatch2: 105,
      snatch3: 0,
      snatch_best: 105,
      cj1: 130,
      cj2: 135,
      cj3: 0,
      cj_best: 135,
      total: 240,
      adaptive: false,
    })).toMatchObject({
      event_id: 'event-1',
      body_weight: 72.5,
      snatch_best: 105,
      cj_best: 135,
    });

    expect(mapApiYearBests({
      best_snatch: 105,
      best_cj: 135,
      best_total: 240,
    })).toEqual({
      bestSnatch: 105,
      bestCJ: 135,
      bestTotal: 240,
    });
  });

  it('maps package schedules into existing offline schedule shape', () => {
    const schedule = mapPackageSchedule({
      meet: {
        id: 'meet-1',
        name: 'Test Meet',
        federation: 'USAW',
        status: 'upcoming',
        start_date: '2026-06-20',
        end_date: '2026-06-21',
        time_zone: 'America/New_York',
        venue_name: 'Test Venue',
        venue_street: '1 Main',
        venue_city: 'Columbus',
        venue_state: 'OH',
        venue_zip: '43215',
      },
      schedule: [
        {
          date: '2026-06-20',
          sessions: [
            {
              session_id: 1,
              start_time: '08:00:00',
              weigh_in_time: '06:00:00',
              platforms: [
                { platform: 'Red', weight_class: '60kg' },
                { platform: 'White', weight_class: '65kg' },
              ],
            },
          ],
        },
      ],
      athletes: [],
      meet_results: [],
      year_bests_by_name: {},
    });

    expect(schedule).toHaveLength(1);
    expect(schedule[0].sessions[0].platforms).toHaveLength(2);
    expect(formatApiTime('08:00:00')).toBe('8:00 AM');
  });

  it('keeps a Gold schedule platform as Gold and canonicalizes casing, never remapping to Red', () => {
    const schedule = mapApiSchedule([
      { date: '2026-06-20', meet: 'Test Meet', platform: 'RED ', session_id: 1, start_time: '08:00', weigh_in_time: '06:00', weight_class: '60kg' },
      { date: '2026-06-20', meet: 'Test Meet', platform: 'gold', session_id: 1, start_time: '08:00', weigh_in_time: '06:00', weight_class: '65kg' },
      { date: '2026-06-20', meet: 'Test Meet', platform: 'stars & stripes', session_id: 2, start_time: '10:00', weigh_in_time: '08:00', weight_class: '71kg' },
      { date: '2026-06-20', meet: 'Test Meet', platform: '  ', session_id: 3, start_time: '12:00', weigh_in_time: '10:00', weight_class: '81kg' },
    ]);
    const sessions = schedule[0].sessions;
    expect(sessions[0].platforms.map((p) => p.platform)).toEqual(['Red', 'Gold']);
    expect(sessions[1].platforms.map((p) => p.platform)).toEqual(['Stars & Stripes']);
    expect(sessions[2].platforms.map((p) => p.platform)).toEqual([UNKNOWN_PLATFORM]);
    expect(normalizePlatform('unknown-color')).toBe('Unknown-color');
  });

  it('gives Red and Gold athletes in one session distinct platforms and session ids', () => {
    const base = {
      member_id: '1', name: 'Athlete A', adaptive: false, age: 24, club: 'Club',
      entry_total: 250, gender: 'Men', weight_class: '73kg', session_number: 4,
    };
    const red = mapApiAthlete({ ...base, session_platform: 'Red' });
    const gold = mapApiAthlete({ ...base, member_id: '2', name: 'Athlete B', session_platform: 'Gold' });
    expect(red.session?.platform).toBe('Red');
    expect(gold.session?.platform).toBe('Gold');
    expect(generateSessionId('Test Meet' as never, 4, red.session!.platform)).not.toBe(
      generateSessionId('Test Meet' as never, 4, gold.session!.platform),
    );
  });

  it('keeps lifting-result age as the API category string', () => {
    expect(mapApiLiftingResult({
      meet: 'Test Meet',
      date: '2026-06-20',
      name: 'Athlete A',
      age: 'Open Men 73kg',
      body_weight: 72.5,
      snatch1: 100,
      snatch2: 105,
      snatch3: 0,
      snatch_best: 105,
      cj1: 130,
      cj2: 135,
      cj3: 0,
      cj_best: 135,
      total: 240,
    }).age).toBe('Open Men 73kg');
  });

  it.each([
    null,
    { name: 123 },
    { name: '   ' },
    { name: 'Athlete A', session_number: 0, session_platform: 'Red' },
  ])(
    'rejects unsalvageable athlete fields at the API mapper: %p', (invalid) => {
      const row = invalid === null ? null : {
        member_id: '123', adaptive: false, age: 24, club: 'Club',
        entry_total: 250, gender: 'Men', weight_class: '73kg',
        ...invalid,
      };
      expect(() => mapApiAthlete(row as never)).toThrow(/athlete/);
    },
  );

  it('defaults nullable club and entry total instead of failing the row', () => {
    const athlete = mapApiAthlete({
      member_id: '123', name: 'Athlete A', adaptive: false, age: 24,
      club: null, entry_total: null, gender: 'Men', weight_class: '73kg',
    } as never);
    expect(athlete.club).toBe('');
    expect(athlete.entryTotal).toBe(0);
    expect(mapApiAthlete({
      member_id: '123', name: 'Athlete A', adaptive: false, age: 24,
      club: 'Club', entry_total: '250', gender: 'Men', weight_class: '73kg',
    } as never).entryTotal).toBe(250);
  });

  it('drops only the unsalvageable rows from a roster', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const base = {
      member_id: '1', adaptive: false, age: 24, club: 'Club',
      entry_total: 250, gender: 'Men', weight_class: '73kg',
    };
    const athletes = mapApiAthletes(
      [
        { ...base, name: 'Athlete A' },
        { ...base, name: '' },
        { ...base, name: 'Athlete B', club: null },
      ] as never,
      '/meets/athletes',
    );
    expect(athletes.map((athlete) => athlete.name)).toEqual(['Athlete A', 'Athlete B']);
    expect(warn).toHaveBeenCalledWith(
      '[api] /meets/athletes: dropped 1 of 3 malformed athlete rows',
    );
    warn.mockRestore();
  });

  it('coerces missing athlete ages to 0 rather than NaN', () => {
    expect(mapApiAthlete({
      member_id: '123',
      adaptive: false,
      age: Number.NaN,
      club: 'Club',
      entry_total: 250,
      gender: 'Men',
      name: 'Athlete A',
      weight_class: '73kg',
    }).age).toBe(0);
  });

  it('drops invalid clock strings instead of echoing them', () => {
    expect(formatApiTime('not-a-time')).toBe('');
    expect(formatApiTime('25:99')).toBe('');
  });

  it('titles schedule days in the meet zone and never renders "Invalid Date"', () => {
    const row = {
      meet: 'Test Meet',
      platform: 'Red',
      session_id: 1,
      start_time: '09:00:00',
      weigh_in_time: '07:00:00',
      weight_class: '60kg',
    };
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Pacific/Auckland');
    const schedule = mapApiSchedule([
      { ...row, date: '2026-06-20' },
      { ...row, date: '2026-06-21T00:00:00' },
      { ...row, date: 'TBD' },
    ]);
    expect(schedule.map((day) => day.date)).toEqual([
      'June 20, 2026',
      'June 21, 2026',
      'TBD',
    ]);
    expect(schedule[2].fullDate).toBe('TBD');
  });

  it('computes New York DST offset from the meet date, not the device zone', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Pacific/Auckland');
    const summer = mapApiMeet({
      name: 'Summer Meet',
      federation: 'USAW',
      status: 'upcoming',
      start_date: '2026-06-20',
      end_date: '2026-06-21',
      time_zone: 'America/New_York',
      venue_name: 'Venue',
      venue_street: '1 Main',
      venue_city: 'Columbus',
      venue_state: 'OH',
      venue_zip: '43215',
    });
    const winter = mapApiMeet({
      name: 'Winter Meet',
      federation: 'USAW',
      status: 'upcoming',
      start_date: '2026-01-15',
      end_date: '2026-01-16',
      time_zone: 'America/New_York',
      venue_name: 'Venue',
      venue_street: '1 Main',
      venue_city: 'Columbus',
      venue_state: 'OH',
      venue_zip: '43215',
    });
    expect(summer.time.utcOffset).toBe(4);
    expect(winter.time.utcOffset).toBe(5);
    expect(summer.time.abbreviation).toBe('EDT');
    expect(winter.time.abbreviation).toBe('EST');
  });

  it('falls unknown IANA zones back to America/New_York for identifier math', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const meet = mapApiMeet({
      name: 'Mystery Meet',
      federation: 'USAW',
      status: 'not-a-status',
      start_date: '2026-06-20',
      end_date: '2026-06-21',
      time_zone: 'Not/AZone',
      venue_name: 'Venue',
      venue_street: '1 Main',
      venue_city: 'Columbus',
      venue_state: 'OH',
      venue_zip: '43215',
    });
    expect(meet.time.timeZoneIdentifier).toBe('America/New_York');
    expect(meet.status).toBe('upcoming');
    expect(meet.timeZoneUnknown).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown meet time zone'));
    warn.mockRestore();
  });

  it('keeps offset, abbreviation and identifier consistent when the zone is unknown', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const meet = mapApiMeet({
      name: 'Mystery Meet',
      status: 'upcoming',
      start_date: '2026-06-20',
      end_date: '2026-06-21',
      time_zone: 'Mars/Olympus',
      venue_name: 'Venue',
      venue_street: '1 Main',
      venue_city: 'Somewhere',
      venue_state: '',
      venue_zip: '',
    });
    expect(meet.timeZoneUnknown).toBe(true);
    expect(meet.time.timeZoneIdentifier).toBe('America/New_York');
    expect(meet.time.utcOffset).toBe(4);
    expect(meet.time.abbreviation).toBe('EDT');
    expect(meet.time.timeZone).toBe('Mars/Olympus');

    const known = mapApiMeet({
      name: 'Home Meet',
      status: 'upcoming',
      start_date: '2026-06-20',
      end_date: '2026-06-21',
      time_zone: 'America/Chicago',
      venue_name: 'Venue',
      venue_street: '1 Main',
      venue_city: 'Chicago',
      venue_state: 'IL',
      venue_zip: '60601',
    });
    expect(known.timeZoneUnknown).toBe(false);
    expect(known.time.utcOffset).toBe(5);
    expect(known.time.abbreviation).toBe('CDT');
  });

  it('gives an id-less lifting result a stable composite event id instead of ""', () => {
    const base = {
      meet: 'Test Meet',
      date: '2026-06-20',
      name: 'Athlete A',
      age: 'Open',
      body_weight: 70,
      snatch1: 0, snatch2: 0, snatch3: 0, snatch_best: 0,
      cj1: 0, cj2: 0, cj3: 0, cj_best: 0, total: 0,
    };
    expect(mapApiLiftingResult({ ...base, event_id: 'evt-1' }).event_id).toBe('evt-1');
    const derived = mapApiLiftingResult({ ...base }).event_id;
    expect(derived).not.toBe('');
    expect(derived).toBe(mapApiLiftingResult({ ...base, event_id: '' }).event_id);
    expect(derived).not.toBe(mapApiLiftingResult({ ...base, date: '2026-06-21' }).event_id);
  });
});

describe('mapApiSchedule platform weigh-ins', () => {
  it('keeps every platform row its own published weigh-in', () => {
    const schedule = mapApiSchedule([
      { date: '2026-06-20', platform: 'Red', session_id: 5, start_time: '09:00:00', weigh_in_time: '07:00:00', weight_class: '89' },
      { date: '2026-06-20', platform: 'Blue', session_id: 5, start_time: '09:30:00', weigh_in_time: '', weight_class: '96' },
    ]);
    const session = schedule[0].sessions[0];
    expect(session.weighInTime).toBe('7:00 AM');
    expect(session.platforms.map((p) => [p.platform, p.platformStartTime, p.platformWeighInTime])).toEqual([
      ['Red', '9:00 AM', '7:00 AM'],
      ['Blue', '9:30 AM', ''],
    ]);
  });
});
