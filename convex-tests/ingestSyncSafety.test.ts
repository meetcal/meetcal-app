import { fakeDb, handlerOf } from './fakeDb';
import {
  deleteLiftingResults,
  deleteMissingIntlRankingGroups,
  pruneEventResults,
  replaceMeetAthletes,
  replaceWsoRecordSet,
  upsertEntryAthletes,
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
    expect(rows('athletes')[0].gender).toBe('Female');
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
  const prune = handlerOf<{ eventId: string; keep: { meet: string; name: string }[]; allowShrink?: boolean }, { deleted: number }>(pruneEventResults);
  const names = (n: number) => Array.from({ length: n }, (_, i) => `Athlete ${i}`);

  beforeEach(() => jest.mocked(writeHistories).mockClear());

  it('deletes a corrected name and a withdrawn result, rewriting their histories', async () => {
    const { db, rows } = fakeDb({
      lifting_results: [...names(20).map((name) => result(name)), result('Jon Smith'), result('Withdrawn'), result('Other Event', 'Open', { eventId: '200' })],
    });
    const keep = [...names(20), 'John Smith'].map((name) => ({ meet: 'Open', name }));
    expect(await prune({ db }, { eventId: '100', keep })).toEqual({ deleted: 2 });
    expect(rows('lifting_results').map((r) => r.name)).toEqual([...names(20), 'Other Event']);
    expect(writeHistories).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(['jon smith', 'withdrawn']));
  });

  it("deletes the rows under a meet's old title without counting them as dropped", async () => {
    const { db, rows } = fakeDb({ lifting_results: names(30).map((name) => result(name, 'Old Title')).concat(names(30).map((name) => result(name, 'New Title'))) });
    expect(await prune({ db }, { eventId: '100', keep: names(30).map((name) => ({ meet: 'New Title', name })) })).toEqual({ deleted: 30 });
    expect(new Set(rows('lifting_results').map((r) => r.meet))).toEqual(new Set(['New Title']));
  });

  it('refuses to drop many athletes without allowShrink, and does with it', async () => {
    const seed = () => fakeDb({ lifting_results: names(40).map((name) => result(name)) });
    const keep = names(30).map((name) => ({ meet: 'Open', name }));
    const refused = seed();
    await expect(prune({ db: refused.db }, { eventId: '100', keep })).rejects.toThrow("refusing to delete 10 of event 100's 40 stored results");
    expect(refused.rows('lifting_results')).toHaveLength(40);
    const allowed = seed();
    expect(await prune({ db: allowed.db }, { eventId: '100', keep, allowShrink: true })).toEqual({ deleted: 10 });
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
