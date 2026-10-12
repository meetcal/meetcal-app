import { fakeDb, handlerOf } from './fakeDb';
import {
  deleteLiftingResults,
  deleteMissingIntlRankingGroups,
  pruneEventResults,
  replaceMeetAthletes,
  RESULT_PRUNE_BATCH,
  replaceWsoRecordSet,
  upsertEntryAthletes,
  upsertLiftingResults,
  upsertRecords,
} from '../convex/ingest';
import { writeHistories } from '../convex/lib/history';

// The derived-data side of each write (versions, history documents, the
// scheduled refresh) has its own tests; here only which rows are written.
jest.mock('../convex/lib/history', () => ({ writeHistories: jest.fn() }));
jest.mock('../convex/lib/views', () => ({ bumpVersion: jest.fn() }));
jest.mock('../convex/views', () => ({ scheduleRefresh: jest.fn() }));

const entry = (name: string, memberId: string, extra: Partial<Record<string, unknown>> = {}) => ({
  memberId,
  name,
  age: 30,
  club: 'Club',
  gender: 'Female',
  weightClass: '64',
  entryTotal: 150,
  meet: 'Meet',
  ...extra,
});

const athlete = (name: string, memberId: string, extra: Partial<Record<string, unknown>> = {}) => ({
  ...entry(name, memberId),
  gender: 'Female',
  adaptive: false,
  ...extra,
});

describe('entries after a published start list (#133)', () => {
  const upsert = handlerOf<{ meet: string; rows: ReturnType<typeof entry>[] }, Record<string, number>>(upsertEntryAthletes);
  const replace = handlerOf<{ meet: string; rows: ReturnType<typeof athlete>[] }, unknown>(replaceMeetAthletes);

  it('adds entrants while no start list is out', async () => {
    const { db, rows } = fakeDb();
    expect(await upsert({ db }, { meet: 'Meet', rows: [entry('Ann Lee', '1'), entry('Bo Kim', '2')] })).toMatchObject({ inserted: 2, notOnStartList: 0 });
    expect(rows('athletes').map((a) => a.name)).toEqual(['Ann Lee', 'Bo Kim']);
  });

  it('does not re-add an entrant the published start list left out, and leaves placed athletes alone', async () => {
    const { db, rows } = fakeDb({ athletes: [athlete('Ann Lee', '1', { sessionNumber: 1, sessionPlatform: 'Red', entryTotal: 140 })] });
    const counts = await upsert({ db }, { meet: 'Meet', rows: [entry('Ann Lee', '1'), entry('Scratched Sam', '3'), entry('No Id', 'noid:no-id')] });
    expect(counts).toMatchObject({ inserted: 0, sessionSkipped: 1, notOnStartList: 2 });
    expect(rows('athletes')).toEqual([expect.objectContaining({ name: 'Ann Lee', entryTotal: 140, sessionNumber: 1 })]);
  });

  it('still updates an unplaced athlete of a published meet', async () => {
    const { db, rows } = fakeDb({
      athletes: [athlete('Ann Lee', '1', { sessionNumber: 1 }), athlete('Bo Kim', '2', { entryTotal: 100 })],
    });
    expect(await upsert({ db }, { meet: 'Meet', rows: [entry('Bo Kim', '2', { entryTotal: 120 })] })).toMatchObject({ updated: 1, inserted: 0 });
    expect(rows('athletes').find((a) => a.name === 'Bo Kim')?.entryTotal).toBe(120);
  });

  it('stores the start list gender normalized, so an athlete without an id matches it', async () => {
    const { db, rows } = fakeDb();
    await replace({ db }, { meet: 'Meet', rows: [athlete('No Id', 'noid:no-id', { gender: ' female ' })] });
    expect(rows('athletes')[0].gender).toBe('Women');
    expect(await upsert({ db }, { meet: 'Meet', rows: [entry('No Id', 'noid:no-id', { entryTotal: 160 })] })).toMatchObject({ updated: 1, inserted: 0 });
  });
});

const result = (name: string, meet = 'Open', extra: Partial<Record<string, unknown>> = {}) => ({
  eventId: '100',
  meet,
  date: '2026-09-01',
  name,
  nameKey: name.toLowerCase(),
  total: 200,
  adaptive: false,
  federation: 'USAW',
  ...extra,
});

describe('pruning an event to its Sport80 table (#97)', () => {
  const prune = handlerOf<{ eventId: string; keep: { meet: string; name: string; age: string | null; date: string }[]; allowShrink?: boolean }, { deleted: number; remaining: number }>(pruneEventResults);
  const names = (n: number) => Array.from({ length: n }, (_, i) => `Athlete ${i}`);

  beforeEach(() => jest.mocked(writeHistories).mockClear());

  it('deletes a corrected name and a withdrawn result, rewriting their histories', async () => {
    const { db, rows } = fakeDb({
      lifting_results: [...names(20).map((name) => result(name)), result('Jon Smith'), result('Withdrawn'), result('Other Event', 'Open', { eventId: '200' })],
    });
    const keep = [...names(20), 'John Smith'].map((name) => ({ meet: 'Open', name, age: null, date: '2026-09-01' }));
    expect(await prune({ db }, { eventId: '100', keep })).toEqual({ deleted: 2, remaining: 0 });
    expect(rows('lifting_results').map((r) => r.name)).toEqual([...names(20), 'Other Event']);
    expect(writeHistories).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(['jon smith', 'withdrawn']));
  });

  it("deletes the rows under a meet's old title without counting them as dropped", async () => {
    const { db, rows } = fakeDb({ lifting_results: names(30).map((name) => result(name, 'Old Title')).concat(names(30).map((name) => result(name, 'New Title'))) });
    expect(await prune({ db }, { eventId: '100', keep: names(30).map((name) => ({ meet: 'New Title', name, age: null, date: '2026-09-01' })) })).toEqual({ deleted: 30, remaining: 0 });
    expect(new Set(rows('lifting_results').map((r) => r.meet))).toEqual(new Set(['New Title']));
  });

  it('refuses to drop many athletes without allowShrink, and does with it', async () => {
    const seed = () => fakeDb({ lifting_results: names(40).map((name) => result(name)) });
    const keep = names(30).map((name) => ({ meet: 'Open', name, age: null, date: '2026-09-01' }));
    const refused = seed();
    await expect(prune({ db: refused.db }, { eventId: '100', keep })).rejects.toThrow("refusing to delete 10 of event 100's 40 stored results");
    expect(refused.rows('lifting_results')).toHaveLength(40);
    const allowed = seed();
    expect(await prune({ db: allowed.db }, { eventId: '100', keep, allowShrink: true })).toEqual({ deleted: 10, remaining: 0 });
  });

  it('deletes a big prune in batches, dropped rows first so the guard still passes on the next call', async () => {
    const athletes = names(RESULT_PRUNE_BATCH + 100);
    const dropped = names(30).map((name) => `Gone ${name}`);
    const { db, rows } = fakeDb({
      lifting_results: [...athletes.map((name) => result(name, 'Old Title')), ...athletes.map((name) => result(name, 'New Title')), ...dropped.map((name) => result(name, 'Old Title'))],
    });
    const keep = athletes.map((name) => ({ meet: 'New Title', name, age: null, date: '2026-09-01' }));
    expect(await prune({ db }, { eventId: '100', keep })).toEqual({ deleted: RESULT_PRUNE_BATCH, remaining: 130 });
    expect(rows('lifting_results').some((r) => String(r.name).startsWith('Gone'))).toBe(false);
    expect(await prune({ db }, { eventId: '100', keep })).toEqual({ deleted: 130, remaining: 0 });
    expect(rows('lifting_results')).toHaveLength(athletes.length);
  });

  it("leaves another source's rows under the same event id alone", async () => {
    const { db, rows } = fakeDb({ lifting_results: [result('A'), result('B', 'Open', { federation: 'IWF' }), result('C', 'Open', { adaptive: true })] });
    expect(await prune({ db }, { eventId: '100', keep: [{ meet: 'Open', name: 'A', age: null, date: '2026-09-01' }] })).toEqual({ deleted: 0, remaining: 0 });
    expect(rows('lifting_results')).toHaveLength(3);
  });

  it('refuses an empty payload', async () => {
    const { db } = fakeDb({ lifting_results: [result('A')] });
    await expect(prune({ db }, { eventId: '100', keep: [] })).rejects.toThrow('empty payload');
  });

  it('deletes by the identity the upsert writes under: event, meet and name', async () => {
    const remove = handlerOf<{ keys: { eventId: string; meet: string; name: string }[] }, { deleted: number }>(deleteLiftingResults);
    const { db, rows } = fakeDb({ lifting_results: [result('A', 'Open'), result('A', 'Masters')] });
    expect(await remove({ db }, { keys: [{ eventId: '100', meet: 'Masters', name: 'A' }] })).toEqual({ deleted: 1 });
    expect(rows('lifting_results').map((r) => r.meet)).toEqual(['Open']);
  });
});

const wsoRow = (weightClass: string, lifts: { snatchRecord?: number; cjRecord?: number; totalRecord?: number }) => ({
  wso: 'Florida',
  ageCategory: 'Senior',
  gender: 'Men',
  weightClass,
  ...lifts,
});

describe('WSO records: lifts cleared count against the shrink guard (#91)', () => {
  const replace = handlerOf<{ wso: string; rows: ReturnType<typeof wsoRow>[]; allowShrink?: boolean }, Record<string, number>>(replaceWsoRecordSet);
  const classes = Array.from({ length: 10 }, (_, i) => String(60 + i));
  const full = classes.map((c) => wsoRow(c, { snatchRecord: 100, cjRecord: 120, totalRecord: 220 }));

  it('refuses a payload that empties many stored lifts', async () => {
    const { db, rows } = fakeDb({ wso_records: full });
    const emptied = classes.map((c) => wsoRow(c, {}));
    await expect(replace({ db }, { wso: 'Florida', rows: emptied })).rejects.toThrow("refusing to clear 30 of Florida's 30 stored WSO record lifts");
    expect(rows('wso_records')).toEqual(full);
  });

  it('takes a few cleared lifts, and many with allowShrink', async () => {
    const { db } = fakeDb({ wso_records: full });
    const oneCleared = full.map((row, i) => (i === 0 ? wsoRow(row.weightClass, { cjRecord: 120, totalRecord: 220 }) : row));
    expect(await replace({ db }, { wso: 'Florida', rows: oneCleared })).toMatchObject({ updated: 1 });
    const other = fakeDb({ wso_records: full });
    expect(await replace({ db: other.db }, { wso: 'Florida', rows: classes.map((c) => wsoRow(c, {})), allowShrink: true })).toMatchObject({ updated: 10 });
  });
});

describe('intl rankings prune guard (#98)', () => {
  const prune = handlerOf<{ groups: { meet: string; gender: string; ageCategory: string }[]; allowShrink?: boolean }, { deleted: number }>(deleteMissingIntlRankingGroups);
  const ranking = (meet: string) => ({ meet, gender: 'Men', ageCategory: 'Senior', ranking: 1, name: 'A' });
  const meets = Array.from({ length: 8 }, (_, i) => `Meet ${i}`);

  it('prunes a group or two the page dropped', async () => {
    const { db, rows } = fakeDb({ intl_rankings: meets.map(ranking) });
    const active = meets.slice(1).map((meet) => ({ meet, gender: 'Men', ageCategory: 'Senior' }));
    expect(await prune({ db }, { groups: active })).toMatchObject({ deleted: 1 });
    expect(rows('intl_rankings')).toHaveLength(7);
  });

  it('refuses to prune most groups unless allowShrink', async () => {
    const active = meets.slice(5).map((meet) => ({ meet, gender: 'Men', ageCategory: 'Senior' }));
    const refused = fakeDb({ intl_rankings: meets.map(ranking) });
    await expect(prune({ db: refused.db }, { groups: active })).rejects.toThrow('refusing to prune 5 of 8 international rankings groups');
    expect(refused.rows('intl_rankings')).toHaveLength(8);
    const allowed = fakeDb({ intl_rankings: meets.map(ranking) });
    expect(await prune({ db: allowed.db }, { groups: active, allowShrink: true })).toMatchObject({ deleted: 5 });
  });
});

describe('result upserts refuse to empty a column (#96)', () => {
  const upsert = handlerOf<{ rows: Record<string, unknown>[]; allowShrink?: boolean }, Record<string, number>>(upsertLiftingResults);
  const athletes = Array.from({ length: 10 }, (_, i) => `Athlete ${i}`);
  const payload = (total?: number) => athletes.map((name) => ({ ...result(name), nameKey: undefined, total }));

  it('refuses a batch that drops the total from every stored row, and takes it with allowShrink', async () => {
    const { db, rows } = fakeDb({ lifting_results: athletes.map((name) => result(name)) });
    await expect(upsert({ db }, { rows: payload(undefined) })).rejects.toThrow('refusing to clear total on most of 10 stored results');
    expect(rows('lifting_results').every((r) => r.total === 200)).toBe(true);
    expect(await upsert({ db }, { rows: payload(undefined), allowShrink: true })).toMatchObject({ updated: 10 });
  });

  it('takes ordinary updates and new rows', async () => {
    const { db } = fakeDb({ lifting_results: athletes.map((name) => result(name)) });
    expect(await upsert({ db }, { rows: [...payload(210), { ...result('New'), nameKey: undefined }] })).toMatchObject({ inserted: 1, updated: 10 });
  });
});

describe('record upserts refuse to clear many lifts (#91)', () => {
  const upsert = handlerOf<{ rows: Record<string, unknown>[]; allowShrink?: boolean }, unknown[]>(upsertRecords);
  const record = (weightClass: string, lifts: Record<string, number>) => ({ recordType: 'UMWF', ageCategory: 'Masters 35', gender: 'Men', weightClass, ...lifts });
  const classes = Array.from({ length: 30 }, (_, i) => `${60 + i}kg`);
  const full = classes.map((c) => record(c, { snatchRecord: 100, cjRecord: 120, totalRecord: 220 }));

  it('refuses a payload that loses one lift on every class (a label the parser stopped finding)', async () => {
    const { db, rows } = fakeDb({ records: full });
    const noCj = classes.map((c) => record(c, { snatchRecord: 100, totalRecord: 220 }));
    await expect(upsert({ db }, { rows: noCj })).rejects.toThrow('refusing to clear 30 of 90 stored record lifts');
    expect(rows('records')).toEqual(full);
    expect(await upsert({ db }, { rows: noCj, allowShrink: true })).toHaveLength(30);
  });

  it('takes a lift or two cleared', async () => {
    const { db } = fakeDb({ records: full });
    const one = full.map((row, i) => (i === 0 ? record(row.weightClass, { snatchRecord: 100 }) : row));
    expect(await upsert({ db }, { rows: one })).toHaveLength(30);
  });

  it('stores a key the payload repeats once, holding its last row', async () => {
    const { db, rows } = fakeDb({ records: [] });
    const outcomes = await upsert({ db }, { rows: [record('60kg', { snatchRecord: 100 }), record('60kg', { snatchRecord: 105 })] });
    expect(outcomes).toEqual([
      { wasInsert: true, wasChanged: true },
      { wasInsert: false, wasChanged: true },
    ]);
    expect(rows('records')).toHaveLength(1);
    expect(rows('records')[0]).toMatchObject({ weightClass: '60kg', snatchRecord: 105 });
    await upsert({ db }, { rows: [record('60kg', { snatchRecord: 110 })] });
    expect(rows('records').map((r) => r.snatchRecord)).toEqual([110]);
  });
});
