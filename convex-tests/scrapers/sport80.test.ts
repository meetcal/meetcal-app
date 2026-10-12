import { readFileSync } from 'fs';
import { join } from 'path';
import { eventDate, eventIdOf, formatResults, nested, newestEvents, unreadableEventDate } from '../../convex/scrapers/parse/sport80';

// The first events of the 2026 index as Sport80 sent them on 2026-10-11 (every
// event of 2025 and 2026 had an ISO date).
const INDEX_BODY: unknown = JSON.parse(readFileSync(join(__dirname, 'fixtures/sport80-event-index-20261011.json'), 'utf8'));
const INDEX_DATA: unknown = typeof INDEX_BODY === 'object' && INDEX_BODY !== null && 'data' in INDEX_BODY ? INDEX_BODY.data : null;
if (!Array.isArray(INDEX_DATA)) throw new Error('fixture has no data array');
const INDEX_EVENTS: Record<string, unknown>[] = INDEX_DATA;

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

  it('parses ISO event dates, the format the event index sends', () => {
    expect(eventDate({ date: '2026-09-13 00:00:00' })).toBe(Date.UTC(2026, 8, 13));
    expect(eventDate({ columns: { 'Start Date': { value: '2026-01-02' } } })).toBe(Date.UTC(2026, 0, 2));
    expect(eventDate({ date: '2026-02-30' })).toBeNull();
    expect(eventDate({ date: null })).toBeNull();
    expect(unreadableEventDate({ date: '2026-09-13' })).toBeNull();
    expect(unreadableEventDate({})).toBeNull();
    for (const event of INDEX_EVENTS) {
      expect(eventDate(event)).not.toBeNull();
      expect(unreadableEventDate(event)).toBeNull();
    }
  });

  it('does not guess at slash dates, which could swap month and day', () => {
    // 05/09/2026 is 9 May in the site's US format; the Python read 5 September.
    for (const date of ['05/09/2026', '13/09/2026', '09/13/2026', 'soon']) {
      expect(eventDate({ date })).toBeNull();
      expect(unreadableEventDate({ date })).toBe(date);
    }
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
    // A value that is not a number invalidates its row (no name: not stored), not the meet.
    const [bad, good] = formatResults('1', 'M', null, [{ lifter: 'X', total: 'DNF' }, { lifter: 'Y', total: '100' }]);
    expect(bad.name).toBeNull();
    expect(good).toMatchObject({ name: 'Y', total: 100 });
  });
});
