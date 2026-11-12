import { readFileSync } from 'fs';
import { join } from 'path';
import { eventDate, eventIdOf, eventSource, formatResults, isSourceOfEvent, nested, failingEventIds, newestEvents, pickNewestEvents, pickNightlyEvents, pickRequestedEvents, ROLLING_NIGHTS, unreadableEventDate } from '../../convex/scrapers/parse/sport80';
import { itemAt } from '../../convex/lib/json';

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

  it('leaves out events with unreadable dates, failing only on ones that could be among the newest', () => {
    const events = [event('7498', '2026-09-13'), event('7505', '2026-9-20'), event('7507', '2026-09-27'), event('7300', '05/09/2025'), event('7510', '10/04/2026')];
    const { newest, unreadable } = pickNewestEvents(events, 2);
    expect(newest.map(eventIdOf)).toEqual(['7507', '7505']);
    expect(unreadable.map(({ event: e, date, recent }) => [eventIdOf(e), date, recent])).toEqual([
      ['7300', '05/09/2025', false],
      ['7510', '10/04/2026', true],
    ]);
    // Fewer readable events than wanted: any unreadable one could be among them.
    expect(itemAt(pickNewestEvents([event('7300', '05/09/2025')], 2).unreadable, 0).recent).toBe(true);
  });

  describe('the events a nightly run reads (#566)', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const tonight = Date.UTC(2026, 10, 11, 6, 5);
    const daysAgo = (days: number) => new Date(tonight - days * DAY).toISOString().slice(0, 10);
    const lastWeekend = Array.from({ length: 40 }, (_, i) => event(String(8000 + i), daysAgo(3)));
    const twoWeeksAgo = Array.from({ length: 40 }, (_, i) => event(String(7900 + i), daysAgo(15)));
    const lastSpring = Array.from({ length: 2 * ROLLING_NIGHTS }, (_, i) => event(String(7000 + i), daysAgo(200)));
    const index = [...lastSpring, ...twoWeeksAgo, ...lastWeekend];
    const idsRead = (now: number) => pickNightlyEvents(index, now, { count: 30 }).newest.map(eventIdOf);

    it('reads every event of the last three weeks, however many were held since', () => {
      const read = new Set(idsRead(tonight));
      for (const recent of [...lastWeekend, ...twoWeeksAgo]) expect(read.has(eventIdOf(recent))).toBe(true);
      expect(pickNightlyEvents(index, tonight, { count: 30 }).recentCount).toBe(80);
    });

    it('reads each older event once every ROLLING_NIGHTS nights, so results posted or corrected late are synced', () => {
      const timesRead = new Map<string, number>();
      for (let night = 0; night < ROLLING_NIGHTS; night += 1) {
        for (const id of idsRead(tonight + night * DAY)) {
          if (id !== null && Number(id) < 7900) timesRead.set(id, (timesRead.get(id) ?? 0) + 1);
        }
      }
      expect(timesRead.size).toBe(lastSpring.length);
      expect([...new Set(timesRead.values())]).toEqual([1]);
    });

    it('reads the same events however often it runs on one night', () => {
      expect(idsRead(tonight)).toEqual(idsRead(tonight + 60 * 60 * 1000));
    });

    it('says how many older events it left out when more are due than one night reads', () => {
      const nightly = pickNightlyEvents(index, tonight, { count: 30, rollingNights: 1, maxRolling: 10 });
      expect(nightly.rollingCount).toBe(10);
      expect(nightly.rollingLeftOut).toBe(lastSpring.length - 10);
    });

    it('reads again, every night, an older event the last run named as failing, until it stops failing', () => {
      const notDueTonight = lastSpring.map(eventIdOf).find((id) => !idsRead(tonight).includes(id))!;
      const stillFailing = failingEventIds([eventSource(`Meet ${notDueTonight}`, notDueTonight), 'event index 2025', 'rolling pass', eventSource(null, '424242')]);
      expect(stillFailing).toEqual([notDueTonight, '424242']);
      const nightly = pickNightlyEvents(index, tonight, { count: 30, stillFailing });
      expect(nightly.newest.map(eventIdOf)).toContain(notDueTonight);
      expect(nightly.retriedCount).toBe(1);
      expect(pickNightlyEvents(index, tonight, { count: 30 }).newest.map(eventIdOf)).not.toContain(notDueTonight);
    });

    it('says which failing events the index read does not hold, so a night without their index does not forget them', () => {
      const nightly = pickNightlyEvents(index, tonight, { count: 30, stillFailing: ['7000', '424242'] });
      expect(nightly.notInTheIndex).toEqual(['424242']);
      expect(isSourceOfEvent(eventSource(null, '424242'), '424242')).toBe(true);
      expect(isSourceOfEvent(eventSource('Some Open', '424242'), '424242')).toBe(true);
      expect(isSourceOfEvent(eventSource('Some Open', '1424242'), '424242')).toBe(false);
    });

    it('counts an event dated exactly three weeks ago as recent, and one a day older as not', () => {
      const edge = [event('6021', daysAgo(21)), event('6022', daysAgo(22)), ...lastWeekend];
      const read = pickNightlyEvents(edge, tonight, { count: 30, rollingNights: 1000 });
      expect(read.newest.map(eventIdOf)).toContain('6021');
      expect(read.newest.map(eventIdOf)).not.toContain('6022');
    });

    it('fails on an event with an unreadable date among the events of the last three weeks', () => {
      const withTypo = [...index, event('7990', '10/27/2026')];
      const unreadable = pickNightlyEvents(withTypo, tonight, { count: 30 }).unreadable;
      expect(unreadable.map(({ event: e, recent }) => [eventIdOf(e), recent])).toEqual([['7990', true]]);
      const longAgo = pickNightlyEvents([...index, event('6000', '05/09/2025')], tonight, { count: 30 }).unreadable;
      expect(longAgo.map(({ event: e, recent }) => [eventIdOf(e), recent])).toEqual([['6000', false]]);
    });

    it('still reads the newest events when none was held in the last three weeks', () => {
      const quiet = pickNightlyEvents(lastSpring, tonight, { count: 30 });
      expect(quiet.recentCount).toBe(30);
    });
  });

  it('finds events asked for by id however many newer events there are, and names the ids the index lacks (#265)', () => {
    // 7400 is far older than the newest 2: the override must still reach it.
    const events = [event('7400', '2026-03-01'), event('7498', '2026-09-13'), event('7507', '2026-09-27'), event('7401', '03/08/2026'), event('7402', null), event('7400', '2026-03-01')];
    expect(pickNewestEvents(events, 2).newest.map(eventIdOf)).not.toContain('7400');
    const { picked, unreadable, missing } = pickRequestedEvents(events, ['7400', '7401', '7402', '9999']);
    expect(picked.map(eventIdOf)).toEqual(['7400']);
    // An unreadable date, or none at all (its rows would be stored undated).
    expect(unreadable.map(({ event: e, date, recent }) => [eventIdOf(e), date, recent])).toEqual([
      ['7401', '03/08/2026', true],
      ['7402', '', true],
    ]);
    expect(missing).toEqual(['9999']);
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
    const mixed = formatResults('1', 'M', null, [{ lifter: 'X', total: 'DNF' }, { lifter: 'Y', total: '100' }]);
    const [bad, good] = [itemAt(mixed, 0), itemAt(mixed, 1)];
    expect(bad.name).toBeNull();
    expect(good).toMatchObject({ name: 'Y', total: 100 });
  });
});
