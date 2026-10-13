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

describe('entries a list no longer has, and renamed or re-numbered entrants (#251, #386, #384)', () => {
  type Args = { meet: string; rows: ReturnType<typeof entry>[]; complete?: boolean; allowShrink?: boolean };
  const upsert = handlerOf<Args, Record<string, number>>(upsertEntryAthletes);
  const names = (n: number) => Array.from({ length: n }, (_, i) => `Lifter ${i}`);

  it('deletes an entrant who withdrew before the start list, only for a whole list', async () => {
    const { db, rows } = fakeDb({ athletes: names(10).map((name, i) => athlete(name, String(i + 1))) });
    const list = names(9).map((name, i) => entry(name, String(i + 1)));
    expect(await upsert({ db }, { meet: 'Meet', rows: list })).toMatchObject({ deleted: 0 });
    expect(rows('athletes')).toHaveLength(10);
    expect(await upsert({ db }, { meet: 'Meet', rows: list, complete: true })).toMatchObject({ deleted: 1, unchanged: 9 });
    expect(rows('athletes').map((a) => a.name)).not.toContain('Lifter 9');
  });

  it('keeps a published roster, placed rows and adaptive entrants whatever the list says', async () => {
    const published = fakeDb({ athletes: [athlete('Placed', '1', { sessionNumber: 1, sessionPlatform: 'Red' }), athlete('Unplaced', '2')] });
    await upsert({ db: published.db }, { meet: 'Meet', rows: [entry('Placed', '1')], complete: true });
    expect(published.rows('athletes')).toHaveLength(2);
    const adaptive = fakeDb({ athletes: [athlete('Ann', '1'), athlete('Adaptive Al', '2', { adaptive: true })] });
    await upsert({ db: adaptive.db }, { meet: 'Meet', rows: [entry('Ann', '1')], complete: true });
    expect(adaptive.rows('athletes').map((a) => a.name)).toEqual(['Ann', 'Adaptive Al']);
  });

  it("never prunes a start list loaded with only half its sessions, whose athletes aren't on Sport80's list", async () => {
    const { db, rows } = fakeDb({ athletes: [athlete('Start List Only', '4225', { sessionNumber: 3 }), athlete('Ann', '1')] });
    expect(await upsert({ db }, { meet: 'Meet', rows: [entry('Ann', '1')], complete: true })).toMatchObject({ deleted: 0 });
    expect(rows('athletes').map((a) => a.name)).toEqual(['Start List Only', 'Ann']);
  });

  it('refuses to delete a large share of the entrants without allowShrink', async () => {
    const seed = () => fakeDb({ athletes: names(40).map((name, i) => athlete(name, String(i + 1))) });
    const list = names(20).map((name, i) => entry(name, String(i + 1)));
    await expect(upsert({ db: seed().db }, { meet: 'Meet', rows: list, complete: true })).rejects.toThrow("refusing to delete 20 of Meet's 40 entrants");
    const allowed = seed();
    expect(await upsert({ db: allowed.db }, { meet: 'Meet', rows: list, complete: true, allowShrink: true })).toMatchObject({ deleted: 20 });
  });

  it('renames the row of a member whose name Sport80 corrected, rather than add a second', async () => {
    const { db, rows } = fakeDb({ athletes: [athlete('Jon Smith', '1078562', { gender: 'Women' }), athlete('Ann Lee', '2', { gender: 'Women' })] });
    expect(await upsert({ db }, { meet: 'Meet', rows: [entry('John Smith', '1078562'), entry('Ann Lee', '2')], complete: true })).toMatchObject({ inserted: 0, updated: 1, deleted: 0 });
    expect(rows('athletes').map((a) => [a.name, a.memberId])).toEqual([
      ['John Smith', '1078562'],
      ['Ann Lee', '2'],
    ]);
  });

  it("takes over an old scraper's one-off id once the entrant has a real number", async () => {
    const { db, rows } = fakeDb({ athletes: [athlete('Kimberly Wiese', '140203020', { weightClass: '69' })] });
    expect(await upsert({ db }, { meet: 'Meet', rows: [entry('Kimberly Wiese', '1027360', { weightClass: '77' })] })).toMatchObject({ inserted: 0, updated: 1 });
    expect(rows('athletes')).toEqual([expect.objectContaining({ name: 'Kimberly Wiese', memberId: '1027360', weightClass: '77' })]);
  });

  it("leaves a same-name athlete of another age alone rather than take over their nine-digit id", async () => {
    const { db, rows } = fakeDb({ athletes: [athlete('Alex Lee', '123456789', { age: 18 })] });
    expect(await upsert({ db }, { meet: 'Meet', rows: [entry('Alex Lee', '7654321', { age: 35 })] })).toMatchObject({ inserted: 1, updated: 0 });
    expect(rows('athletes').map((a) => [a.memberId, a.age]).sort()).toEqual([
      ['123456789', 18],
      ['7654321', 35],
    ]);
  });

  it('takes over no one-off id when two rows of the name could be the entrant', async () => {
    const { db, rows } = fakeDb({ athletes: [athlete('Sam Roe', '140203020'), athlete('Sam Roe', '140203021')] });
    expect(await upsert({ db }, { meet: 'Meet', rows: [entry('Sam Roe', '1027360')] })).toMatchObject({ inserted: 1, updated: 0 });
    expect(rows('athletes').map((a) => a.memberId).sort()).toEqual(['1027360', '140203020', '140203021']);
  });

  it('stores an entrant listed twice once, with the last listing', async () => {
    const { db, rows } = fakeDb();
    expect(await upsert({ db }, { meet: 'Meet', rows: [entry('Ann Lee', '123', { entryTotal: 140 }), entry('ANN  LEE', '123', { entryTotal: 150 })] })).toMatchObject({ inserted: 1 });
    expect(rows('athletes')).toEqual([expect.objectContaining({ memberId: '123', entryTotal: 150 })]);
  });

  it('leaves a nine-digit id another meet also holds (a real number), and stores no placeholder rows', async () => {
    const { db, rows } = fakeDb({ athletes: [athlete('Kim Lee', '123456789'), athlete('Kim Lee', '123456789', { meet: 'Other' })] });
    const counts = await upsert({ db }, { meet: 'Meet', rows: [entry('Kim Lee', '7654321'), entry('undefined undefined', 'No Member Entries'), entry(' ', '5')] });
    expect(counts).toMatchObject({ inserted: 1, rejected: 2 });
    expect(rows('athletes').filter((a) => a.meet === 'Meet').map((a) => a.memberId).sort()).toEqual(['123456789', '7654321']);
  });
});

describe('start lists loaded by hand (#388, #219)', () => {
  type Args = { meet: string; rows: ReturnType<typeof athlete>[]; allowUnchecked?: boolean };
  const replace = handlerOf<Args, unknown>(replaceMeetAthletes);
  const roster = (n: number, extra: (i: number) => Partial<Record<string, unknown>> = () => ({})) =>
    Array.from({ length: n }, (_, i) =>
      athlete(`Lifter ${i}`, String(i + 1), { age: 15 + (i % 30), weightClass: i % 10 === 0 ? '86+' : '77', ...extra(i) }),
    );

  it('stores a sound list, with a blank member id as the placeholder', async () => {
    const { db, rows } = fakeDb();
    await replace({ db }, { meet: 'Meet', rows: [...roster(60), athlete('No Id', '', { age: 30 })] });
    expect(rows('athletes')).toHaveLength(61);
    expect(rows('athletes').find((a) => a.name === 'No Id')?.memberId).toBe('noid:no-id');
  });

  it.each([
    ['ages of 0', roster(30, () => ({ age: 0 })), 'age outside 5-100'],
    ['ages as category buckets', roster(30, (i) => ({ age: i % 3 === 0 ? 30 : 25 })), 'have age 25'],
    ["superheavy classes without their '+'", roster(60, () => ({ weightClass: '86' })), 'no superheavy (+) class'],
    ['a woman stored as a man', [athlete('Lucy Korn', '1', { gender: 'Male', weightClass: '63' })], "only the other gender's"],
    ['category text as the class', [athlete('Ann', '1', { weightClass: "Women's 16-17 Age Group 77+kg" })], 'not a bare class'],
    ['an unknown gender', [athlete('Ann', '1', { gender: '' })], 'neither men nor women'],
  ])('refuses %s unless allowUnchecked', async (_what, rows, message) => {
    const refused = fakeDb({ athletes: [athlete('Kept', '9')] });
    await expect(replace({ db: refused.db }, { meet: 'Meet', rows })).rejects.toThrow(message);
    expect(refused.rows('athletes').map((a) => a.name)).toEqual(['Kept']);
    const allowed = fakeDb();
    await replace({ db: allowed.db }, { meet: 'Meet', rows, allowUnchecked: true });
    expect(allowed.rows('athletes')).toHaveLength(rows.length);
  });

  it('always refuses a row with half a session (#219)', async () => {
    const { db } = fakeDb();
    for (const half of [{ sessionNumber: 3 }, { sessionPlatform: 'Red' }, { sessionNumber: 3, sessionPlatform: ' ' }]) {
      await expect(replace({ db }, { meet: 'Meet', rows: [athlete('Ann', '1', half)], allowUnchecked: true })).rejects.toThrow('only one of sessionNumber and sessionPlatform');
    }
  });

  it('lets the entries sync treat a roster with only half sessions as unpublished, as the start list shows it', async () => {
    const upsert = handlerOf<{ meet: string; rows: ReturnType<typeof entry>[] }, Record<string, number>>(upsertEntryAthletes);
    const { db } = fakeDb({ athletes: [athlete('Ann', '1', { sessionNumber: 3 })] });
    expect(await upsert({ db }, { meet: 'Meet', rows: [entry('Bo', '2')] })).toMatchObject({ inserted: 1, notOnStartList: 0 });
  });
});
