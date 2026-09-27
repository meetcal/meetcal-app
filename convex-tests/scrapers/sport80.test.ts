import { eventDate, eventIdOf, formatResults, nested, newestEvents } from '../../convex/scrapers/parse/sport80';

const event = (id: string, date: string | null, meet = `Meet ${id}`) => ({
  meet,
  date,
  action: [{ route: `/public/events/${id}` }],
});

describe('Sport80 results sync (port of update_supabase_from_sport80.py)', () => {
  it('reads a column value when columns exist, the plain key otherwise', () => {
    expect(nested({ columns: { Athlete: { value: 'Ann' } }, lifter: 'Bob' }, 'lifter', 'Athlete')).toBe('Ann');
    expect(nested({ columns: {}, lifter: 'Bob' }, 'lifter', 'Athlete')).toBeNull();
    expect(nested({ lifter: 'Bob' }, 'lifter', 'Athlete')).toBe('Bob');
  });

  it('parses event dates in the Python formats, day/month before month/day', () => {
    expect(eventDate({ date: '2026-09-13 00:00:00' })).toBe(Date.UTC(2026, 8, 13));
    expect(eventDate({ date: '13/09/2026' })).toBe(Date.UTC(2026, 8, 13));
    expect(eventDate({ date: '09/13/2026' })).toBe(Date.UTC(2026, 8, 13));
    expect(eventDate({ date: 'soon' })).toBeNull();
    expect(eventDate({ columns: { 'Start Date': { value: '2026-01-02' } } })).toBe(Date.UTC(2026, 0, 2));
  });

  it('keeps the newest events, same-date ones by event id, undated last', () => {
    const events = [event('7498', '2026-09-13'), event('7400', null), event('7505', '2026-09-13'), event('7507', '2026-09-20')];
    expect(newestEvents(events, 3).map(eventIdOf)).toEqual(['7507', '7505', '7498']);
    expect(eventIdOf({ id: 42 })).toBe('42');
  });

  it('formats result rows with the Python fallbacks and float conversion', () => {
    const rows = formatResults('7507', 'DMV', Date.UTC(2026, 8, 20), [
      { lifter: 'Caleb Goodman', age_category: "Open Men's 95kg", body_weight_kg: '89.1', snatch_lift_1: 120, snatch_lift_2: '130', snatch_lift_3: '-137', best_snatch: 130, cj_lift_1: 160, 'c&j_lift_2': 170, cj_lift_3: 182, 'best_c&j': 182, total: 312 },
      { name: 'No Lifts', age: 'Youth' },
    ]);
    expect(rows[0]).toEqual({
      eventId: '7507', meet: 'DMV', date: '2026-09-20', name: 'Caleb Goodman', age: "Open Men's 95kg", bodyWeight: 89.1,
      snatch1: 120, snatch2: 130, snatch3: -137, snatchBest: 130, cj1: 160, cj2: 170, cj3: 182, cjBest: 182, total: 312,
      adaptive: false, federation: 'USAW',
    });
    expect(rows[1]).toMatchObject({ name: 'No Lifts', age: 'Youth', snatch1: null, total: null });
    expect(formatResults('1', 'M', null, [])).toEqual([]);
    expect(() => formatResults('1', 'M', null, [{ lifter: 'X', total: 'DNF' }])).toThrow('not a number');
  });
});
