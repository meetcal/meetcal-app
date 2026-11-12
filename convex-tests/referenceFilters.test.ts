import { computeQualifyingTotals, computeRecords, filterWsoRows } from '../convex/lib/referenceData';
import { qualifyingTotalsOfEventKey, recordsOfFederationKey, REF_VIEWS } from '../convex/lib/viewKeys';
import { etagOf } from '../convex/lib/etag';
import { itemAt } from '../convex/lib/json';
import { readViewJsonAnyAge } from '../convex/lib/views';
import { qualifyingTotalCategories, qualifyingTotals, recordCategories, records } from '../convex/reference';
import { buildReferenceTables } from '../convex/views';
import { ANONYMOUS_AUTH, fakeDb, handlerOf } from './fakeDb';

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));

type Answer = { etag: string; json?: string };

const ask = async (fn: unknown, db: unknown, args: Record<string, unknown>) => await handlerOf<Record<string, unknown>, Answer>(fn)({ db, auth: ANONYMOUS_AUTH }, args);
const rowsOf = (answer: Answer) => JSON.parse(answer.json ?? 'null') as Record<string, unknown>[];

const record = (recordType: string, gender: string, ageCategory: string, weightClass: string, totalRecord = 200) => ({
  recordType,
  gender,
  ageCategory,
  weightClass,
  snatchRecord: 90,
  cjRecord: totalRecord - 90,
  totalRecord,
});

const RECORDS = [
  record('USAW', 'Men', 'Senior', '110+', 400),
  record('USAW', 'Men', 'Senior', '60', 280),
  record('USAW', 'Women', 'Senior', '48'),
  record('USAW', 'Male', 'Masters 35', '60'),
  record('IWF', 'Men', 'Senior', '60', 310),
  record('IWF', 'Women', 'Junior', '48', 190),
];

const total = (eventName: string, gender: string, ageCategory: string, weightClass: string, qualifyingTotal: number) => ({
  eventName,
  gender,
  ageCategory,
  weightClass,
  qualifyingTotal,
});

const TOTALS = [
  total('2027 Nationals', 'Men', 'Junior', '60', 205),
  total('2027 Nationals', 'Women', 'Junior', '48', 130),
  total('2027 Nationals', 'Men', 'Senior', '60', 240),
  total('2027 Series', 'Men', 'Junior', '60', 190),
];

async function built(seed: Record<string, Record<string, unknown>[]>) {
  const fake = fakeDb(seed);
  await handlerOf(buildReferenceTables)({ db: fake.db }, {});
  return fake;
}

const pending = (table: string) => ({ kind: 'table', key: table, seq: 0, updatedAt: 1 });

describe('records filtered on the server', () => {
  it('answers exactly the whole table without a filter, from the view and live alike', async () => {
    const live = fakeDb({ records: RECORDS });
    const whole = JSON.stringify(await computeRecords({ db: live.db } as never));
    const fake = await built({ records: RECORDS });
    const fromView = await ask(records, fake.db, {});
    const fromLive = await ask(records, live.db, {});
    expect(fromView).toEqual({ etag: etagOf(whole), json: whole });
    expect(fromLive).toEqual(fromView);
  });

  it("answers one federation's rows in the whole table's order, ignoring case and surrounding space", async () => {
    const fake = await built({ records: RECORDS });
    const whole = rowsOf(await ask(records, fake.db, {}));
    const usaw = rowsOf(await ask(records, fake.db, { federation: ' usaw ' }));
    expect(usaw).toEqual(whole.filter((row) => row.record_type === 'USAW'));
    expect(usaw.map((row) => row.weight_class)).toEqual(['48', '60', '60', '110+']);
  });

  it('narrows by age category and gender, any spelling of the gender', async () => {
    const fake = await built({ records: RECORDS });
    const senior = rowsOf(await ask(records, fake.db, { federation: 'USAW', ageCategory: 'senior', gender: 'm' }));
    expect(senior.map((row) => [row.weight_class, row.gender])).toEqual([
      ['60', 'Men'],
      ['110+', 'Men'],
    ]);
    const masters = rowsOf(await ask(records, fake.db, { federation: 'USAW', ageCategory: 'Masters 35', gender: 'Men' }));
    expect(masters).toHaveLength(1);
    const everyWomen = rowsOf(await ask(records, fake.db, { gender: 'female' }));
    expect(everyWomen.map((row) => row.record_type)).toEqual(['USAW', 'IWF']);
  });

  it('answers the same rows and tag while the view is stale as from the view', async () => {
    const fake = await built({ records: RECORDS });
    const fresh = await ask(records, fake.db, { federation: 'IWF' });
    await fake.db.insert('view_hints', pending('records'));
    expect(await ask(records, fake.db, { federation: 'IWF' })).toEqual(fresh);
    const narrowed = await ask(records, fake.db, { federation: 'IWF', gender: 'Women' });
    await fake.db.delete(itemAt(fake.docs('view_hints'), 0)._id);
    expect(await ask(records, fake.db, { federation: 'IWF', gender: 'Women' })).toEqual(narrowed);
  });

  it('answers the tag alone to a client that holds it', async () => {
    const fake = await built({ records: RECORDS });
    const first = await ask(records, fake.db, { federation: 'USAW' });
    expect(await ask(records, fake.db, { federation: 'USAW', ifNoneMatch: first.etag })).toEqual({ etag: first.etag });
    const narrowed = await ask(records, fake.db, { federation: 'USAW', gender: 'Women' });
    expect(narrowed.etag).toBe(etagOf(narrowed.json!));
    expect(await ask(records, fake.db, { federation: 'USAW', gender: 'Women', ifNoneMatch: `W/${narrowed.etag}` })).toEqual({ etag: narrowed.etag });
  });

  it('answers an empty list for a federation with no records, and refuses a blank filter', async () => {
    const fake = await built({ records: RECORDS });
    expect(rowsOf(await ask(records, fake.db, { federation: 'BWL' }))).toEqual([]);
    await expect(ask(records, fake.db, { federation: '  ' })).rejects.toMatchObject({ data: { status: 400 } });
    await expect(ask(records, fake.db, { gender: '' })).rejects.toMatchObject({ data: { status: 400 } });
  });

  it('keeps one view per federation and deletes the view of a federation the table no longer holds', async () => {
    const fake = await built({ records: RECORDS });
    expect(await readViewJsonAnyAge({ db: fake.db } as never, recordsOfFederationKey('IWF'))).not.toBeNull();
    for (const row of fake.docs('records').filter((doc) => doc.recordType === 'IWF')) await fake.db.delete(row._id);
    await handlerOf(buildReferenceTables)({ db: fake.db }, {});
    expect(await readViewJsonAnyAge({ db: fake.db } as never, recordsOfFederationKey('iwf'))).toBeNull();
    expect(rowsOf(await ask(records, fake.db, { federation: 'IWF' }))).toEqual([]);
  });
});

describe('record categories', () => {
  it('lists each federation, gender and age category once, sorted, from the view and live alike', async () => {
    const fake = await built({ records: [...RECORDS, record('USAW', 'Men', 'Senior', '65')] });
    const answer = await ask(recordCategories, fake.db, {});
    expect(rowsOf(answer)).toEqual([
      { record_type: 'IWF', gender: 'Men', age_category: 'Senior' },
      { record_type: 'IWF', gender: 'Women', age_category: 'Junior' },
      { record_type: 'USAW', gender: 'Men', age_category: 'Masters 35' },
      { record_type: 'USAW', gender: 'Men', age_category: 'Senior' },
      { record_type: 'USAW', gender: 'Women', age_category: 'Senior' },
    ]);
    const live = fakeDb({ records: [...RECORDS, record('USAW', 'Men', 'Senior', '65')] });
    expect(await ask(recordCategories, live.db, {})).toEqual(answer);
    expect(await ask(recordCategories, fake.db, { ifNoneMatch: answer.etag })).toEqual({ etag: answer.etag });
    expect(await readViewJsonAnyAge({ db: fake.db } as never, REF_VIEWS.record_categories)).toBe(answer.json);
  });
});

describe('qualifying totals filtered on the server', () => {
  it('answers exactly the whole table without a filter', async () => {
    const live = fakeDb({ qualifying_totals: TOTALS });
    const whole = JSON.stringify(await computeQualifyingTotals({ db: live.db } as never));
    const fake = await built({ qualifying_totals: TOTALS });
    expect(await ask(qualifyingTotals, fake.db, {})).toEqual({ etag: etagOf(whole), json: whole });
    expect(await ask(qualifyingTotals, live.db, {})).toEqual({ etag: etagOf(whole), json: whole });
  });

  it("answers one event's totals, narrowed by age category and gender", async () => {
    const fake = await built({ qualifying_totals: TOTALS });
    const nationals = rowsOf(await ask(qualifyingTotals, fake.db, { event: '2027 NATIONALS' }));
    expect(nationals.map((row) => row.qualifying_total)).toEqual([130, 205, 240]);
    const junior = rowsOf(await ask(qualifyingTotals, fake.db, { event: '2027 Nationals', ageCategory: 'Junior', gender: 'Men' }));
    expect(junior).toEqual([{ event_name: '2027 Nationals', gender: 'Men', age_category: 'Junior', weight_class: '60', qualifying_total: 205 }]);
    expect(await readViewJsonAnyAge({ db: fake.db } as never, qualifyingTotalsOfEventKey('2027 nationals'))).not.toBeNull();
  });

  it('answers the same from a stale view, and the tag alone to a client that holds it', async () => {
    const fake = await built({ qualifying_totals: TOTALS });
    const fresh = await ask(qualifyingTotals, fake.db, { event: '2027 Series' });
    expect(await ask(qualifyingTotals, fake.db, { event: '2027 Series', ifNoneMatch: fresh.etag })).toEqual({ etag: fresh.etag });
    await fake.db.insert('view_hints', pending('qualifying_totals'));
    expect(await ask(qualifyingTotals, fake.db, { event: '2027 Series' })).toEqual(fresh);
  });

  it('lists each event, gender and age category once', async () => {
    const fake = await built({ qualifying_totals: TOTALS });
    expect(rowsOf(await ask(qualifyingTotalCategories, fake.db, {}))).toEqual([
      { event_name: '2027 Nationals', gender: 'Men', age_category: 'Junior' },
      { event_name: '2027 Nationals', gender: 'Men', age_category: 'Senior' },
      { event_name: '2027 Nationals', gender: 'Women', age_category: 'Junior' },
      { event_name: '2027 Series', gender: 'Men', age_category: 'Junior' },
    ]);
  });
});

describe('WSO records read the same filter rule', () => {
  it('match an age category ignoring case and surrounding space', () => {
    const rows = [{ age_category: 'Senior', gender: 'Women' }, { age_category: 'Junior', gender: 'Women' }] as never[];
    expect(filterWsoRows(rows, ' senior', 'f')).toEqual([{ age_category: 'Senior', gender: 'Women' }]);
  });
});
