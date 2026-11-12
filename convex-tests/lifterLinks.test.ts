import { itemAt, last } from '../convex/lib/json';
import { fakeMutationCtx, handlerOf } from './fakeDb';
import { writeHistories } from '../convex/lib/history';
import { linkLifterResults, MAX_LIFTER_SIGHTINGS, MAX_LINK_NAMES, queueLifterRelinks, upsertLifters, upsertLiftingResults } from '../convex/ingest';
import { lastCompleteRun, lifterNamesPage, liftersByName, LIFTER_NAMES_PAGE_SIZE, queuedRelinks, recordCompleteRun, unlinkedResultsPage } from '../convex/lifters';

type Row = Record<string, unknown>;

const sighting = (extra: Row = {}): Row => ({
  athleteId: '20730',
  membership: '100',
  name: 'Taylor Johnson',
  gender: 'Men',
  birthYear: 1989,
  club: null,
  wso: 'Tennessee-Kentucky',
  date: '2016-03-19',
  ...extra,
});

const lifter = (athleteId: string, extra: Row = {}): Row => ({ athleteId, name: 'Taylor Johnson', nameKey: 'taylor johnson', seenAt: '2016-03-19', ...extra });

const result = (extra: Row = {}): Row => ({
  eventId: '100',
  meet: 'Kentucky Open',
  date: '2016-03-19',
  name: 'Taylor Johnson',
  nameKey: 'taylor johnson',
  age: "Open Men's 85 kg",
  total: 163,
  snatchBest: 70,
  cjBest: 93,
  adaptive: false,
  federation: 'USAW',
  ...extra,
});

const history = (athleteId: string, results: Row[]) => ({ athleteId, results });
const sourceRow = (extra: Row = {}): Row => ({ date: '2016-03-19', meet: 'Kentucky Open', age: "Open Men's 85 kg", total: 163, snatchBest: 70, cjBest: 93, ...extra });

const upsert = handlerOf<{ sightings: Row[]; queueRelinks?: boolean }, { inserted: number; updated: number; unchanged: number; changedKeys: string[] }>(upsertLifters);
type LinkAnswer = { history: number; fit: number; unlinked: number; changed: number; stale: string[] };
const link = handlerOf<{ names: { nameKey: string; histories?: unknown[] }[]; dryRun?: boolean }, LinkAnswer>(linkLifterResults);

describe('storing lifters from rankings sightings', () => {
  it('inserts a lifter with their memberships and names the key that gained one', async () => {
    const { ctx, rows } = fakeMutationCtx();
    expect(await upsert(ctx, { sightings: [sighting(), sighting({ membership: '200', date: '2015-01-01' })] })).toEqual({
      inserted: 1,
      updated: 0,
      unchanged: 0,
      changedKeys: ['taylor johnson'],
    });
    expect(rows('lifters')).toEqual([
      expect.objectContaining({ athleteId: '20730', nameKey: 'taylor johnson', gender: 'Men', birthYear: 1989, wso: 'Tennessee-Kentucky', seenAt: '2016-03-19' }),
    ]);
    expect(rows('lifter_memberships').map((m) => m.membership).sort()).toEqual(['100', '200']);
  });

  it('queues every name it reports, once, until a relink of that name succeeds', async () => {
    const { ctx, rows } = fakeMutationCtx();
    await upsert(ctx, { sightings: [sighting(), sighting({ athleteId: '22081' })] });
    await upsert(ctx, { sightings: [sighting({ athleteId: '30000' })] });
    expect(rows('lifter_relinks')).toEqual([{ nameKey: 'taylor johnson' }]);
    expect(await handlerOf<Record<string, never>, string[]>(queuedRelinks)(ctx, {})).toEqual(['taylor johnson']);
  });

  it('remembers every name a lifter was stored under, so a renamed lifter stays a candidate for their old one', async () => {
    const { ctx, rows } = fakeMutationCtx();
    await upsert(ctx, { sightings: [sighting({ name: 'Jane Doe', date: '2016-01-01' })] });
    await upsert(ctx, { sightings: [sighting({ name: 'Jane Smith', date: '2020-01-01' })] });
    await upsert(ctx, { sightings: [sighting({ name: 'Jane Smith', date: '2021-01-01' })] });
    expect(rows('lifter_names')).toEqual([
      { nameKey: 'jane doe', athleteId: '20730' },
      { nameKey: 'jane smith', athleteId: '20730' },
    ]);
  });

  it('queues every name a lifter was stored under when their birth year changes, as each may hold results fitted on the old one', async () => {
    const { ctx } = fakeMutationCtx();
    await upsert(ctx, { sightings: [sighting({ name: 'Jane Doe', date: '2016-01-01' })] });
    await upsert(ctx, { sightings: [sighting({ name: 'Jane Roe', date: '2018-01-01' })] });
    await upsert(ctx, { sightings: [sighting({ name: 'Jane Smith', date: '2020-01-01' })] });
    const changed = await upsert(ctx, { sightings: [sighting({ name: 'Jane Smith', date: '2021-01-01', birthYear: 1995 })] });
    expect(changed.changedKeys.sort()).toEqual(['jane doe', 'jane roe', 'jane smith']);
  });

  it('queues nothing when asked not to, as a preview of the links is', async () => {
    const { ctx, rows } = fakeMutationCtx();
    expect(await upsert(ctx, { sightings: [sighting()], queueRelinks: false })).toMatchObject({ inserted: 1, changedKeys: ['taylor johnson'] });
    expect(rows('lifter_relinks')).toEqual([]);
  });

  it('queues the names a run could not relink, once each', async () => {
    const { ctx, rows } = fakeMutationCtx({ lifter_relinks: [{ nameKey: 'a' }] });
    await handlerOf<{ nameKeys: string[] }, null>(queueLifterRelinks)(ctx, { nameKeys: ['a', 'b', 'b'] });
    expect(rows('lifter_relinks')).toEqual([{ nameKey: 'a' }, { nameKey: 'b' }]);
  });

  it('writes nothing for a sighting that changes nothing, and names both keys when a lifter is renamed', async () => {
    const { ctx, rows } = fakeMutationCtx();
    await upsert(ctx, { sightings: [sighting()] });
    expect(await upsert(ctx, { sightings: [sighting({ date: '2015-01-01' })] })).toMatchObject({ unchanged: 1, changedKeys: [] });
    expect(await upsert(ctx, { sightings: [sighting({ name: 'Taylor Johnson-Smith', date: '2017-01-01' })] })).toMatchObject({
      updated: 1,
      changedKeys: ['taylor johnson', 'taylor johnson-smith'],
    });
    expect(rows('lifters')).toHaveLength(1);
  });

  it('names the key of a lifter whose gender or birth year changes, so its fit links are decided again', async () => {
    const { ctx } = fakeMutationCtx();
    await upsert(ctx, { sightings: [sighting({ birthYear: null, gender: null })] });
    expect(await upsert(ctx, { sightings: [sighting({ date: '2017-01-01' })] })).toMatchObject({ updated: 1, changedKeys: ['taylor johnson'] });
    expect(await upsert(ctx, { sightings: [sighting({ date: '2018-01-01', club: 'New Club' })] })).toMatchObject({ updated: 1, changedKeys: [] });
  });

  it('refuses a batch over the limit', async () => {
    const { ctx } = fakeMutationCtx();
    await expect(upsert(ctx, { sightings: Array.from({ length: MAX_LIFTER_SIGHTINGS + 1 }, () => sighting()) })).rejects.toThrow('at most');
  });
});

describe('linking a name’s results to its lifters', () => {
  const withHistories = async (store: ReturnType<typeof fakeMutationCtx>) => {
    await writeHistories(store.ctx as never, ['taylor johnson']);
    return store;
  };
  const twoLifters = () =>
    withHistories(fakeMutationCtx({
      lifters: [lifter('20730', { gender: 'Men', birthYear: 1989 }), lifter('24655', { gender: 'Women', birthYear: 1990 })],
      lifting_results: [
        result(),
        result({ eventId: '200', meet: 'CT Open', date: '2019-08-04', age: "Open Women's 71kg", total: 133, snatchBest: 58, cjBest: 75 }),
        result({ eventId: '300', meet: 'Masters Worlds', federation: 'USAMW', age: "Women's Masters (35-39) 71kg", date: '2026-05-01', total: 120 }),
      ],
    }));

  it('links each row by its Sport80 history, and other federations by fit, with no hints while the answers are unchanged', async () => {
    const { ctx, rows } = await twoLifters();
    const answer = await link(ctx, {
      names: [
        {
          nameKey: 'taylor johnson',
          histories: [history('20730', [sourceRow()]), history('24655', [sourceRow({ date: '2019-08-04', age: "Open Women's 71kg", total: 133, snatchBest: 58, cjBest: 75 })])],
        },
      ],
    });
    expect(answer).toEqual({ history: 2, fit: 1, unlinked: 0, changed: 3, stale: [] });
    expect(rows('lifting_results').map((r) => [r.meet, r.lifterId, r.lifterMatch])).toEqual([
      ['Kentucky Open', '20730', 'history'],
      ['CT Open', '24655', 'history'],
      ['Masters Worlds', '24655', 'fit'],
    ]);
    expect(rows('view_hints')).toEqual([]);
    expect(rows('data_versions')).toEqual([]);
  });

  it('clears a name from the relink queue once it is linked, and keeps it after a dry run', async () => {
    const store = await twoLifters();
    await store.ctx.db.insert('lifter_relinks', { nameKey: 'taylor johnson' });
    const histories = [history('20730', []), history('24655', [])];
    await link(store.ctx, { dryRun: true, names: [{ nameKey: 'taylor johnson', histories }] });
    expect(store.rows('lifter_relinks')).toHaveLength(1);
    await link(store.ctx, { names: [{ nameKey: 'taylor johnson', histories }] });
    expect(store.rows('lifter_relinks')).toEqual([]);
  });

  it('leaves a shared name alone when a lifter’s history is missing, so a lifter added mid-run is never skipped', async () => {
    const { ctx, rows } = await twoLifters();
    await ctx.db.insert('lifter_relinks', { nameKey: 'taylor johnson' });
    expect(await link(ctx, { names: [{ nameKey: 'taylor johnson', histories: [history('20730', [sourceRow()])] }] })).toMatchObject({ changed: 0, stale: ['taylor johnson'] });
    expect(rows('lifting_results').every((r) => r.lifterId === undefined)).toBe(true);
    expect(rows('lifter_relinks')).toHaveLength(1);
  });

  it('links a name with one lifter by their history too, and unlinks a USAW result their history does not hold', async () => {
    const { ctx, rows } = await withHistories(fakeMutationCtx({
      lifters: [lifter('64835', { gender: 'Men', birthYear: 2006 })],
      lifting_results: [result({ age: "Junior Men's 94kg", date: '2025-06-29' }), result({ age: "Junior Men's 94kg", date: '2025-08-01', total: 250, lifterId: '64835', lifterMatch: 'fit' })],
    }));
    expect(await link(ctx, { names: [{ nameKey: 'taylor johnson' }] })).toMatchObject({ changed: 0, stale: ['taylor johnson'] });
    const answer = await link(ctx, { names: [{ nameKey: 'taylor johnson', histories: [history('64835', [sourceRow({ age: "Junior Men's 94kg", date: '2025-06-26' })])] }] });
    expect(answer).toEqual({ history: 1, fit: 0, unlinked: 1, changed: 2, stale: [] });
    expect(rows('lifting_results').map((r) => [r.lifterId ?? null, r.lifterMatch ?? null])).toEqual([
      ['64835', 'history'],
      [null, null],
    ]);
  });

  it('keeps a renamed lifter’s results under their old name with them, rather than give them to the lifter who still has that name', async () => {
    const store = fakeMutationCtx({
      lifters: [
        lifter('1', { name: 'Jane Smith', nameKey: 'jane smith', gender: 'Women', birthYear: 1990 }),
        lifter('2', { name: 'Jane Doe', nameKey: 'jane doe', gender: 'Women', birthYear: 1991 }),
      ],
      lifter_names: [
        { nameKey: 'jane doe', athleteId: '1' },
        { nameKey: 'jane doe', athleteId: '2' },
      ],
      lifting_results: [
        result({ name: 'Jane Doe', nameKey: 'jane doe', age: "Open Women's 71kg" }),
        result({ eventId: '200', name: 'Jane Doe', nameKey: 'jane doe', age: "Open Women's 71kg", date: '2019-01-01', total: 150 }),
      ],
    });
    await writeHistories(store.ctx as never, ['jane doe']);
    const janeDoeRow = { ...sourceRow(), age: "Open Women's 71kg" };
    expect(await link(store.ctx, { names: [{ nameKey: 'jane doe', histories: [history('2', [])] }] })).toMatchObject({ changed: 0, stale: ['jane doe'] });
    const histories = [history('2', [{ ...janeDoeRow, date: '2019-01-01', total: 150 }]), history('1', [janeDoeRow])];
    await link(store.ctx, { names: [{ nameKey: 'jane doe', histories }] });
    const linked = () => store.rows('lifting_results').map((r) => [r.lifterId, r.lifterMatch]);
    expect(linked()).toEqual([
      ['1', 'history'],
      ['2', 'history'],
    ]);
    await link(store.ctx, { names: [{ nameKey: 'jane doe', histories }] });
    expect(linked()).toEqual([
      ['1', 'history'],
      ['2', 'history'],
    ]);
  });

  it('links a name with only other federations’ results by fit, needing no Sport80 history', async () => {
    const { ctx, rows } = await withHistories(fakeMutationCtx({
      lifters: [lifter('11207', { gender: 'Women', birthYear: 1983 })],
      lifting_results: [result({ federation: 'USAMW', age: "Women's Masters (40-44) 64kg", date: '2025-03-26' })],
    }));
    expect(await link(ctx, { names: [{ nameKey: 'taylor johnson' }] })).toEqual({ history: 0, fit: 1, unlinked: 0, changed: 1, stale: [] });
    expect(rows('lifting_results')[0]).toMatchObject({ lifterId: '11207', lifterMatch: 'fit' });
  });

  it('counts what it would change in a dry run and writes nothing', async () => {
    const { ctx, rows } = await twoLifters();
    const answer = await link(ctx, { dryRun: true, names: [{ nameKey: 'taylor johnson', histories: [history('20730', []), history('24655', [])] }] });
    expect(answer).toEqual({ history: 0, fit: 1, unlinked: 2, changed: 1, stale: [] });
    expect(rows('lifting_results').every((r) => r.lifterId === undefined)).toBe(true);
  });

  it('refuses a batch over the limit', async () => {
    const { ctx } = fakeMutationCtx();
    await expect(link(ctx, { names: Array.from({ length: MAX_LINK_NAMES + 1 }, (_, i) => ({ nameKey: `n${i}` })) })).rejects.toThrow('at most');
  });
});

describe('a result re-sync and its lifter link', () => {
  const upsertResults = handlerOf<{ rows: Row[] }, Record<string, number>>(upsertLiftingResults);
  const { nameKey: _key, ...incoming } = result();

  it('keeps the link when the source sends the row unchanged, and when it corrects the row, which is still the same lifter’s result', async () => {
    const { ctx, rows } = fakeMutationCtx({ lifting_results: [result({ lifterId: '20730', lifterMatch: 'history' })] });
    expect(await upsertResults(ctx, { rows: [incoming] })).toMatchObject({ unchanged: 1, updated: 0 });
    expect(rows('lifting_results')[0]).toMatchObject({ lifterId: '20730', lifterMatch: 'history' });
    expect(await upsertResults(ctx, { rows: [{ ...incoming, total: 165 }] })).toMatchObject({ updated: 1 });
    expect(rows('lifting_results')[0]).toMatchObject({ total: 165, lifterId: '20730', lifterMatch: 'history' });
  });

  it('keeps the link of a result that comes twice in one batch', async () => {
    const { ctx, rows } = fakeMutationCtx({ lifting_results: [result({ lifterId: '20730', lifterMatch: 'history' })] });
    expect(await upsertResults(ctx, { rows: [{ ...incoming, total: 165 }, { ...incoming, total: 166 }] })).toMatchObject({ updated: 2 });
    expect(rows('lifting_results')).toEqual([expect.objectContaining({ total: 166, lifterId: '20730', lifterMatch: 'history' })]);
  });
});

describe('the reads the lifter jobs page through', () => {
  const unlinked = handlerOf<{ insertedSince: number; cursor: string | null }, { rows: Row[]; isDone: boolean }>(unlinkedResultsPage);
  const names = handlerOf<{ after: string }, { names: string[]; done: boolean }>(lifterNamesPage);
  const byName = handlerOf<{ nameKeys: string[] }, { nameKey: string; athleteIds: string[]; sport80Results: boolean }[]>(liftersByName);

  it('lists the results stored since a time that have no lifter, of every federation and whatever their meet date', async () => {
    const { ctx, docs } = fakeMutationCtx({
      lifting_results: [
        result({ meet: 'Stored before' }),
        result({ date: '2026-10-01' }),
        result({ date: '2026-10-02', lifterId: '1', lifterMatch: 'fit' }),
        result({ date: '2026-10-03', federation: 'USAMW' }),
        result({ date: '2012-01-01' }),
      ],
    });
    const insertedSince = itemAt(docs('lifting_results'), 1)._creationTime;
    expect(await unlinked(ctx, { insertedSince, cursor: null })).toMatchObject({
      rows: [
        { nameKey: 'taylor johnson', date: '2026-10-01', federation: 'USAW', storedAt: itemAt(docs('lifting_results'), 1)._creationTime },
        { nameKey: 'taylor johnson', date: '2026-10-03', federation: 'USAMW', storedAt: itemAt(docs('lifting_results'), 3)._creationTime },
        { nameKey: 'taylor johnson', date: '2012-01-01', federation: 'USAW', storedAt: itemAt(docs('lifting_results'), 4)._creationTime },
      ],
      isDone: true,
    });
  });

  it('pages every name a lifter was stored under, former ones included, without splitting one name across pages', async () => {
    const seed = Array.from({ length: LIFTER_NAMES_PAGE_SIZE }, (_, i) => ({ nameKey: i < LIFTER_NAMES_PAGE_SIZE - 2 ? `a${String(i).padStart(4, '0')}` : 'zz', athleteId: String(i) }));
    const { ctx } = fakeMutationCtx({ lifter_names: [...seed, { nameKey: 'zz', athleteId: 'last' }] });
    const first = await names(ctx, { after: '' });
    expect(first.done).toBe(false);
    expect(first.names).not.toContain('zz');
    expect(await names(ctx, { after: last(first.names) })).toEqual({ names: ['zz'], done: true });
  });

  it('remembers when the latest complete run started, never moving it back', async () => {
    const { ctx } = fakeMutationCtx();
    const last = handlerOf<Record<string, never>, number | null>(lastCompleteRun);
    const record = handlerOf<{ startedAt: number }, null>(recordCompleteRun);
    expect(await last(ctx, {})).toBeNull();
    await record(ctx, { startedAt: 200 });
    await record(ctx, { startedAt: 100 });
    expect(await last(ctx, {})).toBe(200);
  });

  it('counts a renamed lifter among the lifters of every name they were stored under', async () => {
    const { ctx } = fakeMutationCtx({
      lifters: [lifter('1', { nameKey: 'jane smith' }), lifter('2', { nameKey: 'jane doe' })],
      lifter_names: [
        { nameKey: 'jane doe', athleteId: '1' },
        { nameKey: 'jane smith', athleteId: '1' },
        { nameKey: 'jane doe', athleteId: '2' },
      ],
    });
    expect(await byName(ctx, { nameKeys: ['jane doe', 'jane smith'] })).toEqual([
      { nameKey: 'jane doe', athleteIds: ['2', '1'], sport80Results: false },
      { nameKey: 'jane smith', athleteIds: ['1'], sport80Results: false },
    ]);
  });

  it('looks up the lifters of several names at once', async () => {
    const { ctx } = fakeMutationCtx({
      lifters: [lifter('1'), lifter('2'), lifter('3', { nameKey: 'other' })],
      lifting_results: [result(), result({ name: 'Other', nameKey: 'other', federation: 'USAMW' })],
    });
    expect(await byName(ctx, { nameKeys: ['taylor johnson', 'nobody', 'taylor johnson', 'other'] })).toEqual([
      { nameKey: 'taylor johnson', athleteIds: ['1', '2'], sport80Results: true },
      { nameKey: 'nobody', athleteIds: [], sport80Results: false },
      { nameKey: 'other', athleteIds: ['3'], sport80Results: false },
    ]);
  });
});
