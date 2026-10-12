import { athletesWithSessions, narrowSessions, yearBestsFromTimelines, type RosterItem, type Timeline } from '../convex/lib/meetData';
import { bestsSince, namedBests, ZERO_BESTS, type BestsPoint } from '../convex/lib/results';
import { answerBests, answerYearBests } from '../convex/results';
import type { Mark, Summary } from '../convex/lib/history';

describe('bestsSince', () => {
  const points: BestsPoint[] = [
    ['2026-03-01', 90, 110, 200],
    ['2025-11-01', 95, 105, 198],
    ['2025-06-01', 100, 120, 220],
  ];

  it('takes each lift’s heaviest over the points on or after the date, in any order', () => {
    const expected = { best_snatch: 95, best_cj: 110, best_total: 200 };
    expect(bestsSince(points, '2025-11-01')).toEqual(expected);
    expect(bestsSince([...points].reverse(), '2025-11-01')).toEqual(expected);
    expect(bestsSince([points[2], points[0], points[1]], '2025-11-01')).toEqual(expected);
  });

  it('is null when no point is in range, and zero rather than negative for a point that is', () => {
    expect(bestsSince(points, '2026-03-02')).toBeNull();
    expect(bestsSince([], '2000-01-01')).toBeNull();
    expect(bestsSince([['2026-01-01', -80, 0, 0]], '2026-01-01')).toEqual(ZERO_BESTS);
  });
});

describe('namedBests', () => {
  it('answers each distinct spelling once, in byte order, zeros for a name without bests', () => {
    const bests = new Map([['ann lee', { best_snatch: 1, best_cj: 2, best_total: 3 }]]);
    expect(namedBests(['Zed', 'ANN  LEE', 'Ann Lee', 'Zed'], bests)).toEqual([
      { name: 'ANN  LEE', best_snatch: 1, best_cj: 2, best_total: 3 },
      { name: 'Ann Lee', best_snatch: 1, best_cj: 2, best_total: 3 },
      { name: 'Zed', ...ZERO_BESTS },
    ]);
  });
});

describe('the name-list and meet-package bests', () => {
  it('give the same answer from summary marks and from timelines', () => {
    const marks: Mark[] = [
      ['2026-05-01', 80, 100, 180],
      ['2026-01-10', 85, 95, 178],
      ['2025-01-01', 99, 99, 198],
    ];
    const summaries = new Map<string, Summary>([['ann', { latest: [], marks }]]);
    const timelines: Timeline[] = [['ann', [...marks].reverse().map((m): [string, number, number, number] => [...m])]];
    const names = ['Ann', 'Bea'];

    const fromSummaries = answerBests(summaries, names, '2026-01-01');
    expect(fromSummaries).toEqual(yearBestsFromTimelines(names, timelines, '2026-01-01'));
    expect(fromSummaries[0]).toEqual({ name: 'Ann', best_snatch: 85, best_cj: 100, best_total: 180 });
    expect(answerYearBests(marks, '2026-01-01')).toEqual({ best_snatch: 85, best_cj: 100, best_total: 180 });
    expect(answerYearBests(marks, '2027-01-01')).toEqual(ZERO_BESTS);
  });
});

describe('narrowSessions', () => {
  function item(name: string, session: RosterItem['session']): RosterItem {
    return {
      member_id: name,
      name,
      age: 30,
      club: 'Club',
      wso: null,
      gender: 'F',
      weight_class: '71',
      entry_total: 150,
      adaptive: false,
      session,
      j: 0,
    };
  }
  const scheduled = (n: number, platform: string, date: string | null) => ({
    session_number: n,
    session_platform: platform,
    date,
    start_time: date ? '09:00:00' : null,
    weigh_in_time: date ? '07:00:00' : null,
  });
  const items = [
    item('Ann', scheduled(1, 'Red', '2026-06-20')),
    item('Bea', scheduled(1, 'Blue', '2026-06-20')),
    item('Cat', scheduled(2, 'red', '2026-06-21')),
    // Assigned a session no schedule row matches.
    item('Dee', scheduled(1, 'Red', null)),
    // Not assigned a session at all.
    item('Eve', null),
  ];

  it.each([
    [1, undefined, ['Ann', 'Bea']],
    [undefined, 'RED', ['Ann', 'Cat']],
    [1, ' red ', ['Ann']],
    [3, undefined, []],
  ])('narrowing session %p / platform %p keeps %p, the same rows from a view as computed', (session, platform, names) => {
    const computed = athletesWithSessions(items, session, platform);
    expect(computed.map((row) => row.name)).toEqual(names);
    expect(narrowSessions(athletesWithSessions(items), session, platform)).toEqual(computed);
  });

  it('leaves the unfiltered list a left join', () => {
    expect(athletesWithSessions(items).map((row) => row.name)).toEqual(['Ann', 'Bea', 'Cat', 'Dee', 'Eve']);
  });
});
