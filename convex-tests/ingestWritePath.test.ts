import { fakeMutationCtx, handlerOf } from './fakeDb';
import {
  deleteLiftingResults,
  deleteMissingIntlRankingGroups,
  pruneEventResults,
  replaceMeetAthletes,
  replaceMeetSchedule,
  replaceQualifyingTotalSet,
  replaceWsoRecordSet,
  setMeetSourceId,
  syncUsamwEvents,
  updateMeetStatuses,
  upsertEntryAthletes,
  upsertLiftingResults,
  upsertMeets,
  upsertStandards,
} from '../convex/ingest';

// The whole write path runs here, history documents, versions, hints and the
// scheduled refresh included: only the database is fake.

type Row = Record<string, unknown>;

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const result = (name: string, extra: Row = {}): Row => ({
  eventId: '100',
  meet: 'Open',
  date: '2026-09-01',
  name,
  total: 200,
  adaptive: false,
  federation: 'USAW',
  ...extra,
});

const upsertResults = handlerOf<{ rows: Row[]; allowShrink?: boolean }, Record<string, number>>(upsertLiftingResults);

describe('result identity: event, meet, folded name, age category (#132)', () => {
  it('stores one row for one athlete however the name is cased or spaced, and keys their history by it', async () => {
    const { ctx, rows, scheduled } = fakeMutationCtx();
    expect(await upsertResults(ctx, { rows: [result('John Smith')] })).toMatchObject({ inserted: 1 });
    expect(await upsertResults(ctx, { rows: [result('JOHN  smith', { total: 210 })] })).toMatchObject({ inserted: 0, updated: 1 });
    expect(rows('lifting_results')).toEqual([expect.objectContaining({ name: 'JOHN  smith', nameKey: 'john smith', total: 210 })]);
    const history = rows('athlete_history');
    expect(history).toHaveLength(1);
    expect(history[0].nameKey).toBe('john smith');
    expect(JSON.parse(history[0].json as string)).toHaveLength(1);
    expect(rows('athlete_summary')).toHaveLength(1);
    // Each write bumps the version, leaves its hints and schedules one refresh.
    expect(rows('data_versions')).toEqual([{ table: 'lifting_results', version: 2 }]);
    expect(rows('view_hints').map((h) => `${h.kind}:${h.key}`).sort()).toEqual(
      ['athlete:john smith', 'meet:Open', 'name:JOHN  smith', 'name:John Smith'].sort(),
    );
    expect(scheduled.map((s) => s.name)).toEqual(['views:refresh']);
  });

  it('keeps an athlete entered in two age categories at one meet as two rows, and a re-sync writes nothing', async () => {
    const { ctx, rows } = fakeMutationCtx();
    const payload = [result('Ann Lee', { age: 'Masters 35', total: 150 }), result('Ann Lee', { age: 'Open', total: 151 })];
    expect(await upsertResults(ctx, { rows: payload })).toMatchObject({ inserted: 2 });
    expect(await upsertResults(ctx, { rows: payload })).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 });
    expect(rows('lifting_results').map((r) => [r.age, r.total])).toEqual([
      ['Masters 35', 150],
      ['Open', 151],
    ]);
    expect(rows('data_versions')).toEqual([{ table: 'lifting_results', version: 1 }]);
    // Two classes, both hinted.
    expect(rows('view_hints').filter((h) => h.kind === 'nat').map((h) => h.key).sort()).toEqual(['["USAW","Masters 35"]', '["USAW","Open"]']);
  });

  it('deletes a second stored copy of the row it updates, keeping the exact spelling', async () => {
    const { ctx, rows } = fakeMutationCtx({
      lifting_results: [
        { ...result('John Smith'), nameKey: 'john smith' },
        { ...result('John  Smith'), nameKey: 'john smith' },
        { ...result('John Smith', { meet: 'Other' }), nameKey: 'john smith' },
      ],
    });
    expect(await upsertResults(ctx, { rows: [result('John  Smith', { total: 205 })] })).toMatchObject({ updated: 1, duplicates: 1 });
    expect(rows('lifting_results').map((r) => [r.meet, r.name, r.total])).toEqual([
      ['Open', 'John  Smith', 205],
      ['Other', 'John Smith', 200],
    ]);
  });

  it('matches a row stored under an older key rule, and rekeys it', async () => {
    const { ctx, rows } = fakeMutationCtx({ lifting_results: [{ ...result('Jose\u0301 Pe'), nameKey: 'jose\u0301 pe' }] });
    expect(await upsertResults(ctx, { rows: [result('Jos\u00e9 Pe')] })).toMatchObject({ inserted: 0, updated: 1 });
    expect(rows('lifting_results')).toEqual([expect.objectContaining({ nameKey: 'jos\u00e9 pe' })]);
  });

  it('deletes by the same identity: every spelling, one age category or all', async () => {
    const remove = handlerOf<{ keys: Row[] }, { deleted: number }>(deleteLiftingResults);
    const seed = () =>
      fakeMutationCtx({
        lifting_results: [result('Ann Lee', { age: 'Open' }), result('ann  lee', { age: 'Open' }), result('Ann Lee', { age: 'Masters 35' }), result('Bo Kim')],
      });
    const one = seed();
    expect(await remove(one.ctx, { keys: [{ eventId: '100', meet: 'Open', name: 'ANN LEE', age: 'Open' }] })).toEqual({ deleted: 2 });
    expect(one.rows('lifting_results').map((r) => r.age ?? null)).toEqual(['Masters 35', null]);
    const all = seed();
    expect(await remove(all.ctx, { keys: [{ eventId: '100', meet: 'Open', name: 'Ann Lee' }] })).toEqual({ deleted: 3 });
    expect(all.rows('lifting_results').map((r) => r.name)).toEqual(['Bo Kim']);
    expect(all.rows('athlete_history')).toEqual([]);
  });

  it('prunes on the same identity: a respaced name or a new age category is no stale row to count', async () => {
    const prune = handlerOf<{ eventId: string; keep: Row[]; allowShrink?: boolean }, { deleted: number; remaining: number }>(pruneEventResults);
    const names = Array.from({ length: 20 }, (_, i) => `Athlete ${i}`);
    const { ctx, rows } = fakeMutationCtx({
      lifting_results: [...names.map((name) => result(name, { age: 'Open' })), result('John  Smith', { age: 'Open' }), result('Ann Lee', { age: 'Junior' })],
    });
    const keep = [...names, 'John Smith'].map((name) => ({ meet: 'Open', name, age: 'Open', date: '2026-09-01' })).concat([{ meet: 'Open', name: 'Ann Lee', age: 'Open', date: '2026-09-01' }]);
    // Ann Lee's Junior row is stale (she is Open now) but retitled, not dropped.
    expect(await prune(ctx, { eventId: '100', keep })).toEqual({ deleted: 1, remaining: 0 });
    expect(rows('lifting_results').some((r) => r.name === 'John  Smith')).toBe(true);
    expect(rows('lifting_results').some((r) => r.name === 'Ann Lee')).toBe(false);
  });
});

describe("an event id holding two of a meet's editions (#369)", () => {
  const dallas = (date: string, total: number, extra: Row = {}) => result('Brandon Victorian', { eventId: '4598', meet: 'Dallas', date, total, ...extra });

  it("updates this year's row and leaves another year's result under the same identity alone", async () => {
    const { ctx, rows } = fakeMutationCtx({ lifting_results: [dallas('2020-10-31', 275), dallas('2021-10-24', 310)] });
    expect(await upsertResults(ctx, { rows: [dallas('2021-10-24', 312)] })).toMatchObject({ updated: 1, duplicates: 0 });
    expect(rows('lifting_results').map((r) => [r.date, r.total])).toEqual([
      ['2020-10-31', 275],
      ['2021-10-24', 312],
    ]);
    // A year with no row is a new result, not the other edition's.
    expect(await upsertResults(ctx, { rows: [dallas('2022-10-22', 300)] })).toMatchObject({ inserted: 1, updated: 0 });
    expect(rows('lifting_results')).toHaveLength(3);
  });

  it("never takes another edition's row for this one, even with the same values", async () => {
    const { ctx, rows } = fakeMutationCtx({ lifting_results: [dallas('2020-10-31', 275, { bodyWeight: 80.4 })] });
    expect(await upsertResults(ctx, { rows: [dallas('2021-10-24', 275, { bodyWeight: 80.4 })] })).toMatchObject({ inserted: 1, updated: 0 });
    expect(rows('lifting_results').map((r) => r.date)).toEqual(['2020-10-31', '2021-10-24']);
  });

  it('takes a row dated across New Year as the same edition', async () => {
    const { ctx, rows } = fakeMutationCtx({ lifting_results: [dallas('2023-01-05', 200)] });
    expect(await upsertResults(ctx, { rows: [dallas('2022-12-31', 200)] })).toMatchObject({ inserted: 0, updated: 1 });
    expect(rows('lifting_results').map((r) => r.date)).toEqual(['2022-12-31']);
  });

  it("updates this edition's row even when another edition's holds the same values", async () => {
    const { ctx, rows } = fakeMutationCtx({
      lifting_results: [dallas('2020-10-31', 275, { bodyWeight: 80.4 }), dallas('2021-10-24', 310, { bodyWeight: 80.9 })],
    });
    expect(await upsertResults(ctx, { rows: [dallas('2021-10-24', 275, { bodyWeight: 80.4 })] })).toMatchObject({ updated: 1, duplicates: 0 });
    expect(rows('lifting_results').map((r) => [r.date, r.total])).toEqual([
      ['2020-10-31', 275],
      ['2021-10-24', 275],
    ]);
  });

  it("prunes only the payload's edition", async () => {
    const prune = handlerOf<{ eventId: string; keep: Row[] }, { deleted: number; remaining: number }>(pruneEventResults);
    const { ctx, rows } = fakeMutationCtx({
      lifting_results: [dallas('2020-10-31', 275), dallas('2021-10-24', 310), result('Withdrawn', { eventId: '4598', meet: 'Dallas', date: '2021-10-24' })],
    });
    expect(await prune(ctx, { eventId: '4598', keep: [{ meet: 'Dallas', name: 'Brandon Victorian', age: null, date: '2021-10-24' }] })).toEqual({
      deleted: 1,
      remaining: 0,
    });
    expect(rows('lifting_results').map((r) => [r.name, r.date])).toEqual([
      ['Brandon Victorian', '2020-10-31'],
      ['Brandon Victorian', '2021-10-24'],
    ]);
  });
});

const meetRow = (name: string, extra: Row = {}): Row => ({
  name,
  venueName: 'Hall',
  venueStreet: '1 Main St',
  venueCity: 'Columbus',
  venueState: 'OH',
  venueZip: '43004',
  timeZone: 'America/New_York',
  startDate: '2026-11-07',
  endDate: '2026-11-08',
  status: 'upcoming',
  federation: 'USAW',
  ...extra,
});
const NOW = Date.UTC(2026, 9, 12, 16);

describe('meet writes', () => {
  const upsert = handlerOf<{ rows: Row[] }, { wasInsert: boolean; wasChanged: boolean; storedAs?: string; retitledFrom?: string }[]>(upsertMeets);
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(NOW));

  it('reopens a completed meet whose dates moved into the future (#158)', async () => {
    const { ctx, rows } = fakeMutationCtx({ meets: [{ ...meetRow('Fall Open', { startDate: '2026-01-07', endDate: '2026-01-08', status: 'completed' }), updatedAt: 1 }] });
    expect(await upsert(ctx, { rows: [meetRow('Fall Open')] })).toEqual([{ wasInsert: false, wasChanged: true }]);
    expect(rows('meets')).toEqual([expect.objectContaining({ status: 'upcoming', startDate: '2026-11-07', updatedAt: NOW })]);
  });

  it('stores what the dates say: completed when past, ongoing when under way (#160)', async () => {
    const { ctx, rows } = fakeMutationCtx();
    await upsert(ctx, {
      rows: [meetRow('Past', { startDate: '2026-10-01', endDate: '2026-10-02' }), meetRow('Now', { startDate: '2026-10-11', endDate: '2026-10-12' })],
    });
    expect(rows('meets').map((m) => [m.name, m.status])).toEqual([
      ['Past', 'completed'],
      ['Now', 'ongoing'],
    ]);
  });

  it("never takes over another federation's meet of the same name (#159)", async () => {
    const usamw = { ...meetRow('2027 Masters Nationals', { federation: 'USAMW', venueCity: 'Reno', venueState: 'NV', timeZone: 'America/Los_Angeles' }), updatedAt: 1 };
    const { ctx, rows } = fakeMutationCtx({ meets: [usamw] });
    expect(await upsert(ctx, { rows: [meetRow('2027 Masters Nationals')] })).toEqual([
      { wasInsert: true, wasChanged: true, storedAs: '2027 Masters Nationals (USAW)' },
    ]);
    // The next sync finds its own meet under the stored name.
    expect(await upsert(ctx, { rows: [meetRow('2027 Masters Nationals', { venueName: 'Arena' })] })).toEqual([
      { wasInsert: false, wasChanged: true, storedAs: '2027 Masters Nationals (USAW)' },
    ]);
    expect(rows('meets').map((m) => [m.name, m.federation, m.venueCity, m.venueName])).toEqual([
      ['2027 Masters Nationals', 'USAMW', 'Reno', 'Hall'],
      ['2027 Masters Nationals (USAW)', 'USAW', 'Columbus', 'Arena'],
    ]);
  });

  it('never takes a meet the source really calls "<name> (<federation>)" for a disambiguated one (#159)', async () => {
    const { ctx, rows } = fakeMutationCtx({
      meets: [
        { ...meetRow('Open'), updatedAt: 1 },
        { ...meetRow('Open (USAMW)', { federation: 'USAMW', venueCity: 'Reno' }), updatedAt: 1 },
      ],
    });
    const usamwOpen = meetRow('Open', { federation: 'USAMW', venueCity: 'Tampa' });
    expect(await upsert(ctx, { rows: [usamwOpen] })).toEqual([{ wasInsert: true, wasChanged: true, storedAs: 'Open (USAMW 2)' }]);
    // The next sync finds it again, and the source's "Open (USAMW)" still finds its own meet.
    expect(await upsert(ctx, { rows: [usamwOpen] })).toEqual([{ wasInsert: false, wasChanged: false, storedAs: 'Open (USAMW 2)' }]);
    expect(await upsert(ctx, { rows: [meetRow('Open (USAMW)', { federation: 'USAMW', venueCity: 'Reno' })] })).toEqual([{ wasInsert: false, wasChanged: false }]);
    expect(rows('meets').map((m) => [m.name, m.federation, m.venueCity, m.sourceName])).toEqual([
      ['Open', 'USAW', 'Columbus', undefined],
      ['Open (USAMW)', 'USAMW', 'Reno', undefined],
      ['Open (USAMW 2)', 'USAMW', 'Tampa', 'Open'],
    ]);
  });

  it('never takes a disambiguated meet for one the source calls by that name (#159)', async () => {
    const { ctx, rows } = fakeMutationCtx({
      meets: [
        { ...meetRow('Open'), updatedAt: 1 },
        { ...meetRow('Open (USAMW)', { federation: 'USAMW', venueCity: 'Tampa', sourceName: 'Open' }), updatedAt: 1 },
      ],
    });
    expect(await upsert(ctx, { rows: [meetRow('Open (USAMW)', { federation: 'USAMW', venueCity: 'Reno' })] })).toEqual([
      { wasInsert: true, wasChanged: true, storedAs: 'Open (USAMW) (USAMW)' },
    ]);
    expect(rows('meets').map((m) => [m.name, m.venueCity])).toEqual([
      ['Open', 'Columbus'],
      ['Open (USAMW)', 'Tampa'],
      ['Open (USAMW) (USAMW)', 'Reno'],
    ]);
  });

  it('keeps the stored zone for a row without one, stores a new one blank, and never completes it early', async () => {
    // 09:00 UTC on Oct 13: 02:00 on the 13th in Los Angeles, still the 12th in UTC-12.
    jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 13, 9));
    const withoutZone = (name: string): Row => {
      const { timeZone: _zone, ...row } = meetRow(name, { startDate: '2026-10-11', endDate: '2026-10-12' });
      return row;
    };
    const stored = { ...meetRow('LA Open', { timeZone: 'America/Los_Angeles', startDate: '2026-10-11', endDate: '2026-10-12', status: 'ongoing' }), updatedAt: 1 };
    const { ctx, rows } = fakeMutationCtx({ meets: [stored] });
    await upsert(ctx, { rows: [withoutZone('LA Open'), withoutZone('Toronto Open'), { ...withoutZone('Blank Open'), timeZone: ' ' }] });
    expect(rows('meets').map((m) => [m.name, m.timeZone, m.status])).toEqual([
      ['LA Open', 'America/Los_Angeles', 'completed'],
      ['Toronto Open', '', 'ongoing'],
      ['Blank Open', '', 'ongoing'],
    ]);
  });

  describe('Sport80 event ids (#252, #413)', () => {
    const NJ = '2026 New Jersey WSO Championship (NUQ)';
    const NJ_NEW = '2026 New Jersey State Championship (NUQ)';

    it('keeps a retitled meet as one meet under its stored name, with the new title as its source name, reported once', async () => {
      const { ctx, rows } = fakeMutationCtx({ meets: [{ ...meetRow(NJ, { sourceId: '14836' }), updatedAt: 1 }] });
      expect(await upsert(ctx, { rows: [meetRow(NJ_NEW, { sourceId: '14836' })] })).toEqual([
        { wasInsert: false, wasChanged: true, storedAs: NJ, retitledFrom: NJ },
      ]);
      // The next sync finds it the same way, and reports nothing new.
      expect(await upsert(ctx, { rows: [meetRow(NJ_NEW, { sourceId: '14836' })] })).toEqual([{ wasInsert: false, wasChanged: false, storedAs: NJ }]);
      expect(rows('meets').map((m) => [m.name, m.sourceName, m.sourceId])).toEqual([[NJ, NJ_NEW, '14836']]);
      expect(rows('view_hints').map((h) => `${h.kind}:${h.key}`)).toEqual([`meet:${NJ}`]);
      // Retitled back: the source's name is the stored one again.
      expect(await upsert(ctx, { rows: [meetRow(NJ, { sourceId: '14836' })] })).toEqual([{ wasInsert: false, wasChanged: true, retitledFrom: NJ_NEW }]);
      expect(rows('meets').map((m) => [m.name, m.sourceName])).toEqual([[NJ, undefined]]);
    });

    it('gives a meet found by name its event id without invalidating its views, then follows it through a retitle', async () => {
      const { ctx, rows } = fakeMutationCtx({ meets: [{ ...meetRow(NJ), updatedAt: 1 }] });
      expect(await upsert(ctx, { rows: [meetRow(NJ, { sourceId: '14836' })] })).toEqual([{ wasInsert: false, wasChanged: false }]);
      expect(rows('meets')).toEqual([expect.objectContaining({ name: NJ, sourceId: '14836', updatedAt: 1 })]);
      expect(rows('view_hints')).toEqual([]);
      await upsert(ctx, { rows: [meetRow(NJ_NEW, { sourceId: '14836' })] });
      expect(rows('meets').map((m) => [m.name, m.sourceName])).toEqual([[NJ, NJ_NEW]]);
    });

    it('never takes a meet of the same name that Sport80 knows by another id: that is another event', async () => {
      const { ctx, rows } = fakeMutationCtx({ meets: [{ ...meetRow('Halloweenie', { startDate: '2025-10-25', endDate: '2025-10-25', status: 'completed', sourceId: '13000' }), updatedAt: 1 }] });
      expect(await upsert(ctx, { rows: [meetRow('Halloweenie', { sourceId: '15060' })] })).toEqual([
        { wasInsert: true, wasChanged: true, storedAs: 'Halloweenie (USAW)' },
      ]);
      expect(rows('meets').map((m) => [m.name, m.startDate, m.sourceId, m.sourceName])).toEqual([
        ['Halloweenie', '2025-10-25', '13000', undefined],
        ['Halloweenie (USAW)', '2026-11-07', '15060', 'Halloweenie'],
      ]);
    });

    it('stores a new meet with its event id', async () => {
      const { ctx, rows } = fakeMutationCtx();
      await upsert(ctx, { rows: [meetRow('Open', { sourceId: '1' })] });
      expect(rows('meets')).toEqual([expect.objectContaining({ name: 'Open', sourceId: '1' })]);
    });

    it('ties a stored meet to its event by hand, once', async () => {
      const setSourceId = handlerOf<{ name: string; sourceId: string }, { changed: boolean }>(setMeetSourceId);
      const { ctx, rows } = fakeMutationCtx({ meets: [{ ...meetRow(NJ), updatedAt: 1 }, { ...meetRow('Other', { sourceId: '7' }), updatedAt: 1 }] });
      await expect(setSourceId(ctx, { name: NJ, sourceId: 'abc' })).rejects.toThrow('not a Sport80 event id');
      await expect(setSourceId(ctx, { name: 'Nope', sourceId: '14836' })).rejects.toThrow('no meet named');
      await expect(setSourceId(ctx, { name: NJ, sourceId: '7' })).rejects.toThrow('already the meet "Other"');
      expect(await setSourceId(ctx, { name: NJ, sourceId: '14836' })).toEqual({ changed: true });
      expect(await setSourceId(ctx, { name: NJ, sourceId: '14836' })).toEqual({ changed: false });
      // The next sync follows the retitle.
      await upsert(ctx, { rows: [meetRow(NJ_NEW, { sourceId: '14836' })] });
      expect(rows('meets').map((m) => [m.name, m.sourceName])).toEqual([
        [NJ, NJ_NEW],
        ['Other', undefined],
      ]);
    });
  });

  it('treats a meet stored without a federation as USAW', async () => {
    const { federation: _f, ...legacy } = meetRow('Old Open');
    const { ctx, rows } = fakeMutationCtx({ meets: [{ ...legacy, updatedAt: 1 }] });
    expect(await upsert(ctx, { rows: [meetRow('Old Open')] })).toEqual([{ wasInsert: false, wasChanged: true }]);
    expect(rows('meets')).toHaveLength(1);
  });

  describe('USA Masters events', () => {
    const sync = handlerOf<{ events: Row[] }, Record<string, string[]>>(syncUsamwEvents);
    const event = (name: string, extra: Row = {}): Row => ({
      name,
      startDate: '2027-04-10',
      endDate: '2027-04-12',
      venueName: 'Arena',
      venueCity: 'Reno',
      venueState: 'NV',
      timeZone: 'America/Los_Angeles',
      ...extra,
    });

    it('matches a stored meet by name even when its dates fall before the payload (#134)', async () => {
      const stored = { ...meetRow('2027 USA Masters Nationals', { federation: 'USAMW', startDate: '2026-04-10', endDate: '2026-04-12', status: 'completed' }), updatedAt: 1 };
      const { ctx, rows } = fakeMutationCtx({ meets: [stored] });
      const outcome = await sync(ctx, { events: [event('2027 USA Masters Nationals')] });
      expect(outcome.inserted).toEqual([]);
      expect(outcome.updated).toHaveLength(1);
      expect(rows('meets')).toEqual([expect.objectContaining({ name: '2027 USA Masters Nationals', startDate: '2027-04-10', status: 'upcoming', venueCity: 'Reno' })]);
    });

    it("inserts a new event under a disambiguated name when another federation's meet has its name (#159)", async () => {
      const { ctx, rows } = fakeMutationCtx({ meets: [{ ...meetRow('Spring Classic'), updatedAt: 1 }] });
      expect(await sync(ctx, { events: [event('Spring Classic')] })).toMatchObject({ inserted: ['Spring Classic (USAMW)'], renamed: ['Spring Classic (USAMW)'] });
      // Reported once, when stored: the next sync just finds it.
      expect(await sync(ctx, { events: [event('Spring Classic')] })).toMatchObject({ unchanged: ['Spring Classic (USAMW)'], renamed: [] });
      expect(rows('meets').map((m) => [m.name, m.federation, m.sourceName])).toEqual([
        ['Spring Classic', 'USAW', undefined],
        ['Spring Classic (USAMW)', 'USAMW', 'Spring Classic'],
      ]);
    });

    it('takes an event with no time zone (a meet in Canada or Mexico)', () => {
      type Field = { fieldType: { type: string; value?: unknown }; optional: boolean };
      const args = JSON.parse((syncUsamwEvents as unknown as { exportArgs(): string }).exportArgs()) as { value: { events: Field } };
      const eventFields = (args.value.events.fieldType.value as { value: Record<string, Field> }).value;
      expect(eventFields.timeZone.optional).toBe(true);
      expect(eventFields.name.optional).toBe(false);
    });

    it('stores a new event without a zone blank, and keeps or clears a stored zone by where the event is', async () => {
      // 03:00 UTC on Apr 13: the UTC date is past the end, but it is still
      // the 12th west of UTC, so the zoneless meet is not completed early.
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2027, 3, 13, 3));
      const { timeZone: _zone, ...toronto } = event('Canadian Masters Open', { venueCity: 'Toronto', venueState: 'Canada' });
      const masters = (name: string) => ({ ...meetRow(name, { federation: 'USAMW', startDate: '2027-04-10', endDate: '2027-04-12', venueCity: 'Reno', venueState: 'NV', timeZone: 'America/Los_Angeles' }), updatedAt: 1 });
      const { ctx, rows } = fakeMutationCtx({ meets: [masters('Same State'), masters('Moved Abroad')] });
      const outcome = await sync(ctx, {
        events: [
          toronto,
          // Still in Nevada, no zone given (blank): the stored one is kept.
          event('Same State', { venueCity: 'Las Vegas', timeZone: '' }),
          // Moved to Mexico, which has several zones: Pacific would be wrong there.
          { ...toronto, name: 'Moved Abroad', venueCity: 'Monterrey', venueState: 'Mexico' },
        ],
      });
      expect(outcome.inserted).toEqual(['Canadian Masters Open']);
      expect(rows('meets').map((m) => [m.name, m.venueState, m.timeZone, m.status])).toEqual([
        ['Same State', 'NV', 'America/Los_Angeles', 'ongoing'],
        ['Moved Abroad', 'Mexico', '', 'ongoing'],
        ['Canadian Masters Open', 'Canada', '', 'ongoing'],
      ]);
    });

    it('falls back to the one overlapping meet, and reports two as ambiguous', async () => {
      const masters = (name: string) => ({ ...meetRow(name, { federation: 'USAMW', startDate: '2027-04-11', endDate: '2027-04-11' }), updatedAt: 1 });
      const one = fakeMutationCtx({ meets: [masters('Nationals')] });
      expect((await sync(one.ctx, { events: [event('National Masters')] })).updated).toHaveLength(1);
      const two = fakeMutationCtx({ meets: [masters('A'), masters('B')] });
      expect((await sync(two.ctx, { events: [event('National Masters')] })).ambiguous).toEqual(['National Masters: A / B']);
    });
  });

  describe('hourly statuses (#158, #160)', () => {
    const update = handlerOf<Record<string, never>, number>(updateMeetStatuses);

    it("moves meets to ongoing, completed and back to upcoming on each meet's own calendar", async () => {
      // 03:00 UTC on Oct 13: still Oct 12 in New York and Los Angeles.
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 13, 3));
      const { ctx, rows } = fakeMutationCtx({
        meets: [
          { ...meetRow('LA ends today', { timeZone: 'America/Los_Angeles', startDate: '2026-10-11', endDate: '2026-10-12', status: 'ongoing' }), updatedAt: 1 },
          { ...meetRow('London ended', { timeZone: 'Europe/London', startDate: '2026-10-11', endDate: '2026-10-12', status: 'ongoing' }), updatedAt: 1 },
          { ...meetRow('Starts today', { startDate: '2026-10-12', endDate: '2026-10-13' }), updatedAt: 1 },
          { ...meetRow('Moved by hand', { status: 'completed' }), updatedAt: 1 },
          { ...meetRow('Long done', { startDate: '2025-01-01', endDate: '2025-01-02', status: 'completed' }), updatedAt: 1 },
          // Stored unpadded by the old meet scraper: ended Sep 25.
          { ...meetRow('Unpadded', { startDate: '2026-9-24', endDate: '2026-9-25' }), updatedAt: 1 },
        ],
      });
      expect(await update(ctx, {})).toBe(4);
      expect(rows('meets').map((m) => [m.name, m.status])).toEqual([
        ['LA ends today', 'ongoing'],
        ['London ended', 'completed'],
        ['Starts today', 'ongoing'],
        ['Moved by hand', 'upcoming'],
        ['Long done', 'completed'],
        ['Unpadded', 'completed'],
      ]);
      expect(rows('view_hints').map((h) => h.key).sort()).toEqual(['London ended', 'Moved by hand', 'Starts today', 'Unpadded']);
      expect(await update(ctx, {})).toBe(0);
    });

    it('never moves a meet with no zone, or an unreadable one, before UTC-12 does', async () => {
      const zoneless = (name: string, timeZone: string, extra: Row) => ({ ...meetRow(name, { timeZone, ...extra }), updatedAt: 1 });
      const { ctx, rows } = fakeMutationCtx({
        meets: [
          zoneless('Blank ends', '', { startDate: '2026-10-11', endDate: '2026-10-12', status: 'ongoing' }),
          zoneless('Unreadable ends', 'Not/AZone', { startDate: '2026-10-11', endDate: '2026-10-12', status: 'ongoing' }),
          zoneless('Blank starts', '', { startDate: '2026-10-13', endDate: '2026-10-14' }),
        ],
      });
      // 03:00 UTC on Oct 13: the UTC date has passed the end of the first two
      // and reached the start of the third, but UTC-12 is still on the 12th.
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 13, 3));
      expect(await update(ctx, {})).toBe(0);
      // 12:00 UTC on Oct 13: the 13th everywhere.
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 13, 12));
      expect(await update(ctx, {})).toBe(3);
      expect(rows('meets').map((m) => [m.name, m.status])).toEqual([
        ['Blank ends', 'completed'],
        ['Unreadable ends', 'completed'],
        ['Blank starts', 'ongoing'],
      ]);
    });
  });
});

const athlete = (name: string, extra: Row = {}): Row => ({
  memberId: '1',
  name,
  age: 30,
  club: 'Club',
  gender: 'Female',
  weightClass: '64',
  entryTotal: 150,
  meet: 'Meet',
  adaptive: false,
  ...extra,
});

describe('athletes and schedules', () => {
  it('matches an entry to an athlete stored with the old gender spelling, and stores the canonical one (#165)', async () => {
    const upsert = handlerOf<{ meet: string; rows: Row[] }, Record<string, number>>(upsertEntryAthletes);
    const { adaptive: _a, ...entry } = athlete('No Id', { memberId: 'noid:no-id', gender: 'female', entryTotal: 160 });
    const { ctx, rows } = fakeMutationCtx({ athletes: [athlete('No Id', { memberId: 'noid:no-id', gender: 'Female' })] });
    expect(await upsert(ctx, { meet: 'Meet', rows: [entry] })).toMatchObject({ updated: 1, inserted: 0 });
    expect(rows('athletes')).toEqual([expect.objectContaining({ gender: 'Women', entryTotal: 160 })]);
  });

  it('refuses an empty start list or schedule unless asked to clear it (#135)', async () => {
    const replaceAthletes = handlerOf<{ meet: string; rows: Row[]; allowEmpty?: boolean }, unknown>(replaceMeetAthletes);
    const replaceSchedule = handlerOf<{ meet: string; rows: Row[]; allowEmpty?: boolean }, unknown>(replaceMeetSchedule);
    const schedule = { date: '2026-11-07', sessionId: 1, startTime: '09:00', weighInTime: '07:00', platform: 'Red', weightClass: '64', meet: 'Meet' };
    const { ctx, rows } = fakeMutationCtx({ athletes: [athlete('Ann Lee')], session_schedule: [schedule] });
    await expect(replaceAthletes(ctx, { meet: 'Meet', rows: [] })).rejects.toThrow("refusing to replace Meet's start list with an empty payload");
    await expect(replaceSchedule(ctx, { meet: 'Meet', rows: [] })).rejects.toThrow("refusing to replace Meet's schedule with an empty payload");
    expect(rows('athletes')).toHaveLength(1);
    expect(rows('session_schedule')).toHaveLength(1);
    expect(await replaceAthletes(ctx, { meet: 'Meet', rows: [], allowEmpty: true })).toEqual({ deleted: 1, inserted: 0 });
    expect(await replaceSchedule(ctx, { meet: 'Meet', rows: [], allowEmpty: true })).toEqual({ deleted: 1, inserted: 0 });
  });
});

describe('reference writers tolerate the old gender spelling until the migration (#165)', () => {
  it('updates a standard stored as Male instead of adding a second row', async () => {
    const upsert = handlerOf<{ rows: Row[] }, unknown[]>(upsertStandards);
    const { ctx, rows } = fakeMutationCtx({ standards: [{ ageCategory: 'Senior', gender: 'Male', weightClass: '89', standardA: 300, standardB: 280 }] });
    expect(await upsert(ctx, { rows: [{ ageCategory: 'senior', gender: 'men', weightClass: '89', standardA: 300, standardB: 280 }] })).toEqual([
      { wasInsert: false, wasChanged: true },
    ]);
    expect(rows('standards')).toEqual([{ ageCategory: 'Senior', gender: 'Men', weightClass: '89', standardA: 300, standardB: 280 }]);
  });

  it('does not count WSO classes stored as Female as dropped', async () => {
    const replace = handlerOf<{ wso: string; rows: Row[]; allowShrink?: boolean }, Record<string, number>>(replaceWsoRecordSet);
    const classes = Array.from({ length: 30 }, (_, i) => String(50 + i));
    const { ctx, rows } = fakeMutationCtx({
      wso_records: classes.map((weightClass) => ({ wso: 'Florida', ageCategory: 'Senior', gender: 'Female', weightClass, snatchRecord: 80 })),
    });
    const counts = await replace(ctx, { wso: 'Florida', rows: classes.map((weightClass) => ({ wso: 'Florida', ageCategory: 'Senior', gender: 'Women', weightClass, snatchRecord: 80 })) });
    expect(counts).toEqual({ inserted: 0, updated: 30, deleted: 0, unchanged: 0 });
    expect(new Set(rows('wso_records').map((r) => r.gender))).toEqual(new Set(['Women']));
  });

  it('does not prune an intl rankings group stored as Male', async () => {
    const prune = handlerOf<{ groups: Row[] }, { deleted: number }>(deleteMissingIntlRankingGroups);
    const { ctx } = fakeMutationCtx({ intl_rankings: [{ meet: 'Worlds', gender: 'Male', ageCategory: 'Senior', ranking: 1, name: 'A' }] });
    expect(await prune(ctx, { groups: [{ meet: 'Worlds', gender: 'Men', ageCategory: 'Senior' }] })).toMatchObject({ deleted: 0 });
  });
});

describe('qualifying totals writer (#135)', () => {
  const replace = handlerOf<{ eventName: string; rows: Row[] }, Record<string, number>>(replaceQualifyingTotalSet);
  const total = (weightClass: string, qualifyingTotal: number, extra: Row = {}) => ({ ageCategory: 'senior', gender: 'female', weightClass, qualifyingTotal, ...extra });

  it("stores one event's totals normalized, as an exact set", async () => {
    const { ctx, rows } = fakeMutationCtx({
      qualifying_totals: [
        { eventName: 'Nationals', ageCategory: 'Senior', gender: 'Female', weightClass: '64', qualifyingTotal: 180 },
        { eventName: 'Nationals', ageCategory: 'Senior', gender: 'Women', weightClass: '71', qualifyingTotal: 190 },
        { eventName: 'Other', ageCategory: 'Senior', gender: 'Women', weightClass: '71', qualifyingTotal: 150 },
      ],
    });
    expect(await replace(ctx, { eventName: 'Nationals', rows: [total('64', 185), total('76', 200)] })).toEqual({ inserted: 1, updated: 1, deleted: 1, unchanged: 0 });
    expect(rows('qualifying_totals')).toEqual([
      { eventName: 'Nationals', ageCategory: 'Senior', gender: 'Women', weightClass: '64', qualifyingTotal: 185 },
      { eventName: 'Other', ageCategory: 'Senior', gender: 'Women', weightClass: '71', qualifyingTotal: 150 },
      { eventName: 'Nationals', ageCategory: 'Senior', gender: 'Women', weightClass: '76', qualifyingTotal: 200 },
    ]);
    expect(await replace(ctx, { eventName: 'Nationals', rows: [total('64', 185), total('76', 200)] })).toEqual({ inserted: 0, updated: 0, deleted: 0, unchanged: 2 });
  });

  it('refuses an empty payload or a class twice', async () => {
    const { ctx } = fakeMutationCtx();
    await expect(replace(ctx, { eventName: 'Nationals', rows: [] })).rejects.toThrow('empty payload');
    await expect(replace(ctx, { eventName: 'Nationals', rows: [total('64', 1), total('64', 2, { gender: 'Women' })] })).rejects.toThrow('Duplicate');
  });
});
