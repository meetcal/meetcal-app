import { ConvexError } from 'convex/values';
import { athleteKey, balancedChunks, buildSchedule, interleave, slotsThatFit, splitLabel, type BuilderEntrant, type BuiltSchedule } from '../convex/lib/scheduleBuilder';
import { checkBuilderEdits, checkBuilderOptions, defaultBuilderOptions, meetDays, minutesOfClock, storedClockOf, type BuilderOptions } from '../convex/lib/scheduleBuilderOptions';

let nextId = 1;
function lifter(gender: 'Women' | 'Men', weightClass: string, entryTotal: number, extra: Partial<BuilderEntrant> = {}): BuilderEntrant {
  const id = nextId++;
  return { memberId: String(100000 + id), name: `Lifter ${id}`, age: 25, club: 'Club', gender, weightClass, entryTotal, ...extra };
}

function options(extra: Partial<BuilderOptions> = {}): BuilderOptions {
  return {
    days: [{ date: '2027-03-06', firstStart: '09:00' }],
    sessionMinutes: 120,
    breakMinutes: 0,
    weighInMinutes: 120,
    maxAthletesPerPlatform: 10,
    maxSessionsPerDay: null,
    platforms: ['Red'],
    grouping: 'weightClass',
    separateAgeGroups: false,
    order: 'womenThenMen',
    ...extra,
  };
}

const many = (count: number, make: (i: number) => BuilderEntrant) => Array.from({ length: count }, (_, i) => make(i));

function summary(schedule: BuiltSchedule) {
  return schedule.sessions.map((s) => ({
    number: s.number,
    date: s.date,
    start: s.startTime,
    groups: s.groups.map((g) => `${g.platform}:${g.gender}:${g.weightClasses.join('/')}${g.split ? `:${g.split}` : ''}:${g.athletes.length}`),
  }));
}

function failureOf(work: () => void): string {
  try {
    work();
    return 'ok';
  } catch (error) {
    if (error instanceof ConvexError) return String((error.data as { error: string }).error);
    throw error;
  }
}

describe('balancedChunks and splitLabel', () => {
  it('cuts into the fewest chunks under the max, as even as possible, larger ones last', () => {
    expect(balancedChunks([1, 2, 3, 4, 5, 6, 7], 3).map((c) => c.length)).toEqual([2, 2, 3]);
    expect(balancedChunks([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
    expect(balancedChunks([], 3)).toEqual([]);
  });

  it('labels the highest-total chunk A and lower ones B, C', () => {
    expect([0, 1, 2].map((i) => splitLabel(i, 3))).toEqual(['C', 'B', 'A']);
    expect(splitLabel(0, 1)).toBe('');
  });

  it('interleaves lists of different lengths', () => {
    expect(interleave([[1, 2, 3], ['a']])).toEqual([1, 'a', 2, 3]);
  });
});

describe('grouping by weight class', () => {
  it('packs whole classes light to heavy up to the max, women before men, never mixing genders', () => {
    const entrants = [...many(4, () => lifter('Women', '58', 80)), ...many(5, () => lifter('Women', '63kg', 90)), ...many(3, () => lifter('Women', '69', 95)), ...many(2, () => lifter('Men', '65', 150))];
    expect(summary(buildSchedule(entrants, options({ maxAthletesPerPlatform: 10 })))).toEqual([
      { number: 1, date: '2027-03-06', start: '09:00:00', groups: ['Red:Female:58/63:9'] },
      { number: 2, date: '2027-03-06', start: '11:00:00', groups: ['Red:Female:69:3'] },
      { number: 3, date: '2027-03-06', start: '13:00:00', groups: ['Red:Male:65:2'] },
    ]);
  });

  it('splits a class over the max into balanced B and A sessions, B (lower totals) first', () => {
    const entrants = many(13, (i) => lifter('Men', '89', 100 + i));
    const schedule = buildSchedule(entrants, options({ maxAthletesPerPlatform: 10 }));
    expect(summary(schedule).map((s) => s.groups)).toEqual([['Red:Male:89:B:6'], ['Red:Male:89:A:7']]);
    expect(schedule.sessions[0]?.groups[0]?.athletes.map((a) => a.entryTotal)).toEqual([100, 101, 102, 103, 104, 105]);
  });

  it('lists each session by entry total and gives the start-list gender spelling', () => {
    const schedule = buildSchedule([lifter('Women', '58', 90), lifter('Women', '58', 70)], options());
    expect(schedule.sessions[0]?.groups[0]?.athletes.map((a) => [a.entryTotal, a.gender])).toEqual([
      [70, 'Female'],
      [90, 'Female'],
    ]);
  });
});

describe('grouping by entry total', () => {
  it('sorts each gender by total and cuts it into even sessions, mixing classes', () => {
    const entrants = many(12, (i) => lifter('Women', i % 2 ? '58' : '77', 50 + i));
    const schedule = buildSchedule(entrants, options({ grouping: 'entryTotal', maxAthletesPerPlatform: 5 }));
    expect(schedule.sessions.map((s) => s.groups[0]?.athletes.map((a) => a.entryTotal))).toEqual([
      [50, 51, 52, 53],
      [54, 55, 56, 57],
      [58, 59, 60, 61],
    ]);
    expect(schedule.sessions[0]?.groups[0]?.weightClasses).toEqual(['58', '77']);
  });
});

describe('age groups', () => {
  it('keeps youth and masters in their own sessions when asked, juniors with seniors', () => {
    const entrants = [lifter('Women', '58', 60, { age: 15 }), lifter('Women', '58', 80, { age: 19 }), lifter('Women', '58', 85, { age: 30 }), lifter('Women', '58', 70, { age: 45 })];
    expect(buildSchedule(entrants, options({ separateAgeGroups: true })).sessions.map((s) => [s.groups[0]?.ageGroup, s.groups[0]?.athletes.length])).toEqual([
      ['youth', 1],
      ['open', 2],
      ['masters', 1],
    ]);
    expect(buildSchedule(entrants, options()).sessions.map((s) => [s.groups[0]?.ageGroup, s.groups[0]?.athletes.length])).toEqual([['', 4]]);
  });
});

describe('order presets and platforms', () => {
  const entrants = () => [...many(3, (i) => lifter('Women', String(48 + i * 5), 70)), ...many(3, (i) => lifter('Men', String(60 + i * 5), 120))];

  it('alternates women and men', () => {
    const schedule = buildSchedule(entrants(), options({ maxAthletesPerPlatform: 1, order: 'alternate' }));
    expect(schedule.sessions.map((s) => s.groups[0]?.gender)).toEqual(['Female', 'Male', 'Female', 'Male', 'Female', 'Male']);
  });

  it("starts the men on a new day for women's day / men's day", () => {
    const days = [
      { date: '2027-03-06', firstStart: '09:00' },
      { date: '2027-03-07', firstStart: '08:00' },
    ];
    const schedule = buildSchedule(entrants(), options({ days, maxAthletesPerPlatform: 1, order: 'womenDayMenDay' }));
    expect(schedule.sessions.map((s) => [s.date, s.startTime, s.groups[0]?.gender])).toEqual([
      ['2027-03-06', '09:00:00', 'Female'],
      ['2027-03-06', '11:00:00', 'Female'],
      ['2027-03-06', '13:00:00', 'Female'],
      ['2027-03-07', '08:00:00', 'Male'],
      ['2027-03-07', '10:00:00', 'Male'],
      ['2027-03-07', '12:00:00', 'Male'],
    ]);
  });

  it('runs one group per platform at the same time', () => {
    const schedule = buildSchedule(entrants(), options({ maxAthletesPerPlatform: 1, platforms: ['Red', 'Blue'] }));
    expect(summary(schedule)).toEqual([
      { number: 1, date: '2027-03-06', start: '09:00:00', groups: ['Red:Female:48:1', 'Blue:Female:53:1'] },
      { number: 2, date: '2027-03-06', start: '11:00:00', groups: ['Red:Female:58:1', 'Blue:Male:60:1'] },
      { number: 3, date: '2027-03-06', start: '13:00:00', groups: ['Red:Male:65:1', 'Blue:Male:70:1'] },
    ]);
  });
});

describe('fitting sessions into days', () => {
  const days = [
    { date: '2027-03-06', firstStart: '09:00' },
    { date: '2027-03-07', firstStart: '09:00' },
  ];

  it('spreads sessions evenly over the days with no cap, with breaks and weigh-ins', () => {
    const schedule = buildSchedule(
      many(4, (i) => lifter('Men', String(60 + i * 5), 100)),
      options({ days, maxAthletesPerPlatform: 1, breakMinutes: 30, weighInMinutes: 90 }),
    );
    expect(schedule.sessions.map((s) => [s.date, s.startTime, s.weighInTime])).toEqual([
      ['2027-03-06', '09:00:00', '07:30:00'],
      ['2027-03-06', '11:30:00', '10:00:00'],
      ['2027-03-07', '09:00:00', '07:30:00'],
      ['2027-03-07', '11:30:00', '10:00:00'],
    ]);
  });

  it('leaves sessions past the days and the cap unscheduled, and says so', () => {
    const schedule = buildSchedule(many(5, (i) => lifter('Men', String(60 + i * 5), 100)), options({ days, maxAthletesPerPlatform: 1, maxSessionsPerDay: 2 }));
    expect(schedule.sessions.map((s) => [s.number, s.date, s.startTime])).toEqual([
      [1, '2027-03-06', '09:00:00'],
      [2, '2027-03-06', '11:00:00'],
      [3, '2027-03-07', '09:00:00'],
      [4, '2027-03-07', '11:00:00'],
      [5, '', ''],
    ]);
    expect(schedule.warnings.map((w) => w.code)).toEqual(['unscheduled']);
  });

  it('never starts a session that would end after midnight', () => {
    expect(slotsThatFit(minutesOfClock('20:00') ?? 0, { sessionMinutes: 120, breakMinutes: 0 })).toBe(2);
    expect(slotsThatFit(minutesOfClock('23:00') ?? 0, { sessionMinutes: 120, breakMinutes: 0 })).toBe(0);
  });

  it('warns when the meet has no entrants', () => {
    expect(buildSchedule([], options())).toEqual({ athletes: 0, sessions: [], warnings: [{ code: 'noEntrants', message: 'The meet has no entrants yet.' }] });
  });
});

describe('edits', () => {
  const base = () => {
    nextId = 1;
    return [lifter('Women', '58', 70), lifter('Women', '58', 75), lifter('Women', '63', 80), lifter('Men', '65', 120)];
  };
  const opts = options({ maxAthletesPerPlatform: 3, platforms: ['Red', 'Blue'] });

  it('moves one athlete to another session and platform', () => {
    const entrants = base();
    const moved = athleteKey(entrants[0] as BuilderEntrant);
    const schedule = buildSchedule(entrants, opts, [{ kind: 'moveAthlete', athlete: moved, toSession: 1, toPlatform: 'Blue' }]);
    expect(summary(schedule)[0]?.groups).toEqual(['Red:Female:58/63:2', 'Blue:Male:58/65:2']);
    expect(schedule.warnings.map((w) => w.code)).toEqual(['mixedGroup']);
  });

  it('moves a whole class out of a group', () => {
    const schedule = buildSchedule(base(), opts, [{ kind: 'moveClass', fromSession: 1, fromPlatform: 'Red', weightClass: '63kg', toSession: 1, toPlatform: 'Blue' }]);
    expect(summary(schedule)[0]?.groups).toEqual(['Red:Female:58:2', 'Blue:Male:63/65:2']);
  });

  it('swaps two sessions, which keep their times', () => {
    const schedule = buildSchedule(many(2, (i) => lifter('Men', String(60 + i * 5), 100)), options({ maxAthletesPerPlatform: 1 }), [{ kind: 'swapSessions', session: 1, withSession: 2 }]);
    expect(summary(schedule).map((s) => [s.start, s.groups[0]])).toEqual([
      ['09:00:00', 'Red:Male:65:1'],
      ['11:00:00', 'Red:Male:60:1'],
    ]);
  });

  it('retimes a session and numbers sessions by time again, keeping their ids', () => {
    const schedule = buildSchedule(many(2, (i) => lifter('Men', String(60 + i * 5), 100)), options({ maxAthletesPerPlatform: 1 }), [{ kind: 'setSessionTime', session: 1, date: '2027-03-06', startTime: '15:00' }]);
    expect(schedule.sessions.map((s) => [s.id, s.number, s.startTime, s.weighInTime])).toEqual([
      [2, 1, '11:00:00', '09:00:00'],
      [1, 2, '15:00:00', '13:00:00'],
    ]);
  });

  it('skips edits that no longer fit and warns about them and about overfull groups', () => {
    const entrants = base();
    const schedule = buildSchedule(entrants, opts, [
      { kind: 'moveAthlete', athlete: 'gone|nobody', toSession: 1, toPlatform: 'Red' },
      { kind: 'moveAthlete', athlete: athleteKey(entrants[3] as BuilderEntrant), toSession: 1, toPlatform: 'Green' },
      { kind: 'setSessionTime', session: 1, date: '2030-01-01', startTime: '09:00' },
      { kind: 'moveAthlete', athlete: athleteKey(entrants[3] as BuilderEntrant), toSession: 1, toPlatform: 'Red' },
    ]);
    expect(schedule.warnings.map((w) => w.code)).toEqual(['mixedGroup', 'overCapacity', 'skippedEdit']);
    expect(schedule.warnings.at(-1)?.message).toBe('3 edits no longer fit the entries and were left out.');
  });
});

describe('options', () => {
  it('defaults to the meet days at 9:00 on one platform', () => {
    const defaults = defaultBuilderOptions({ startDate: '2027-03-06', endDate: '2027-03-07' });
    expect(defaults.days).toEqual([
      { date: '2027-03-06', firstStart: '09:00' },
      { date: '2027-03-07', firstStart: '09:00' },
    ]);
    expect(() => checkBuilderOptions(defaults)).not.toThrow();
  });

  it('caps meet days and reads a blank end as one day', () => {
    expect(meetDays('2027-03-06', '')).toEqual(['2027-03-06']);
    expect(meetDays('2027-03-01', '2027-03-31')).toHaveLength(7);
    expect(meetDays('', '2027-03-06')).toEqual([]);
  });

  it('reads and writes clock times', () => {
    expect(minutesOfClock('7:05')).toBe(425);
    expect(minutesOfClock('24:00')).toBeNull();
    expect(storedClockOf(425)).toBe('07:05:00');
  });

  it.each([
    [{ days: [] }, 'days must list 1 to 7 meet days'],
    [{ maxAthletesPerPlatform: 0 }, 'maxAthletesPerPlatform must be a whole number from 1 to 60'],
    [{ sessionMinutes: 90.5 }, 'sessionMinutes must be a whole number from 15 to 480'],
    [{ maxSessionsPerDay: 0 }, 'maxSessionsPerDay must be a whole number from 1 to 30'],
    [{ days: [{ date: '2027-02-30', firstStart: '09:00' }] }, 'day "2027-02-30" is not a YYYY-MM-DD date'],
    [{ days: [{ date: '2027-03-06', firstStart: '9am' }] }, 'the first start on 2027-03-06 is not an HH:MM time'],
    [{ days: [{ date: '2027-03-06', firstStart: '01:00' }] }, 'the first start on 2027-03-06 leaves no time for its weigh-in'],
    [{ days: [{ date: '2027-03-06', firstStart: '23:00' }] }, 'the first session on 2027-03-06 would end after midnight'],
    [{ platforms: [] }, 'platforms must name 1 to 6 platforms'],
    [{ platforms: ['Red', 'red'] }, 'the platform "red" is listed twice'],
    [{ platforms: [' Red'] }, 'the platform name " Red" has spaces around it'],
  ])('refuses %j', (extra, message) => {
    expect(failureOf(() => checkBuilderOptions(options(extra as Partial<BuilderOptions>)))).toBe(message);
  });

  it('refuses a session time edit that is not a date and time', () => {
    expect(failureOf(() => checkBuilderEdits([{ kind: 'setSessionTime', session: 1, date: 'soon', startTime: '09:00' }]))).toBe('a session time edit needs a YYYY-MM-DD date and an HH:MM start');
  });
});
