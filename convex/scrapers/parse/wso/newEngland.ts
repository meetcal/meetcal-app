import { isRecord } from '../../../lib/json';
import { recordHolder } from '../holder';
import { blankRecord, plusLast, setLift, type LiftName, type WsoRecord } from './common';

export const NEW_ENGLAND_SITE = 'https://www.newenglandweightlifting.com';
export const NEW_ENGLAND_ACCESS_TOKENS_URL = `${NEW_ENGLAND_SITE}/_api/v1/access-tokens`;
export const NEW_ENGLAND_ITEMS_QUERY_URL = `${NEW_ENGLAND_SITE}/_api/cloud-data/v2/items/query`;
export const NEW_ENGLAND_CMS_APP_ID = '8f099af5-b472-4119-abfb-029f1f372d34';
export const NEW_ENGLAND_RECORDS_COLLECTION = 'NewEnglandWeightliftingRecords';
export const NEW_ENGLAND_PAGE_SIZE = 200;
export const NEW_ENGLAND_MAX_PAGES = 25;

export const newEnglandItemsQuery = (offset: number) => ({
  dataCollectionId: NEW_ENGLAND_RECORDS_COLLECTION,
  query: { paging: { limit: NEW_ENGLAND_PAGE_SIZE, offset } },
});

export function newEnglandAccessToken(json: unknown): string {
  const apps = isRecord(json) ? json.apps : undefined;
  const app = isRecord(apps) ? apps[NEW_ENGLAND_CMS_APP_ID] : undefined;
  const token = isRecord(app) ? app.accessToken : undefined;
  if (typeof token !== 'string' || !token) {
    throw new Error(`New England access tokens have no token for the CMS app ${NEW_ENGLAND_CMS_APP_ID}`);
  }
  return token;
}

export function newEnglandItemsPage(json: unknown): unknown[] {
  const items = isRecord(json) ? json.dataItems : undefined;
  if (!Array.isArray(items)) throw new Error(`New England ${NEW_ENGLAND_RECORDS_COLLECTION} query answered without dataItems`);
  return items.map((item: unknown, i) => {
    if (!isRecord(item) || !isRecord(item.data)) throw new Error(`New England ${NEW_ENGLAND_RECORDS_COLLECTION} item ${i} has no data`);
    return item.data;
  });
}

const YOUTH_AGES: Readonly<Record<string, string>> = { '11U': 'U11', '12/13': 'U13', '14/15': 'U15', '16/17': 'U17' };

export function newEnglandAgeCategory(division: string, age: string): string | null {
  if (division === 'Open' && age === '') return 'Senior';
  if (division === 'Junior' && age === '') return 'Junior';
  if (division === 'Youth') return YOUTH_AGES[age] ?? null;
  const masters = division === 'Masters' ? /^(\d+)-(\d+)$/.exec(age) : null;
  return masters ? `Masters ${masters[1]}` : null;
}

const LIFTS: Readonly<Record<string, LiftName>> = { Snatch: 'snatch', 'Clean & Jerk': 'cj', Total: 'total' };
const SEXES = new Set(['Men', 'Women']);

const text = (row: Record<string, unknown>, field: string) => {
  const value = row[field];
  return typeof value === 'string' ? value.trim() : '';
};

function kilos(row: Record<string, unknown>, describe: () => string): number {
  const kg = row.kg;
  if (typeof kg !== 'number' || !Number.isInteger(kg) || kg <= 0) throw new Error(`New England ${describe()}: kg ${JSON.stringify(kg)} is not a whole positive number`);
  return kg;
}

type Lift = { lift: LiftName; value: number | null; holder: ReturnType<typeof recordHolder> };

function liftOf(row: Record<string, unknown>, describe: () => string): Lift {
  const lift = LIFTS[text(row, 'lift')];
  if (!lift) throw new Error(`New England ${describe()}: unknown lift ${JSON.stringify(row.lift)}`);
  const status = text(row, 'status');
  if (status === 'Open') return { lift, value: null, holder: undefined };
  if (status === 'Standard') {
    const value = kilos(row, describe);
    return { lift, value, holder: recordHolder(value, 'Standard') };
  }
  if (status === 'Record') {
    const value = kilos(row, describe);
    const athlete = text(row, 'athlete');
    if (!athlete) throw new Error(`New England ${describe()}: a record with no athlete`);
    return { lift, value, holder: recordHolder(value, athlete, text(row, 'recordDate'), text(row, 'meet')) };
  }
  throw new Error(`New England ${describe()}: unknown status ${JSON.stringify(row.status)}`);
}

export function parseNewEngland(rows: readonly unknown[], wso: string): WsoRecord[] {
  const classes = new Map<string, { record: WsoRecord; lifts: Set<LiftName> }>();
  rows.forEach((raw, i) => {
    if (!isRecord(raw)) throw new Error(`New England row ${i} is not an object`);
    const describe = () => text(raw, 'title') || `row ${i}`;
    const age = newEnglandAgeCategory(text(raw, 'division'), text(raw, 'age'));
    if (!age) throw new Error(`New England ${describe()}: unknown division ${JSON.stringify(raw.division)} and age ${JSON.stringify(raw.age)}`);
    const sex = text(raw, 'sex');
    if (!SEXES.has(sex)) throw new Error(`New England ${describe()}: unknown sex ${JSON.stringify(raw.sex)}`);
    const weightClass = plusLast(text(raw, 'weightClass'));
    if (!/^\d+\+?$/.test(weightClass)) throw new Error(`New England ${describe()}: unreadable weight class ${JSON.stringify(raw.weightClass)}`);
    const { lift, value, holder } = liftOf(raw, describe);
    const key = `${age}|${sex}|${weightClass}`;
    const entry = classes.get(key) ?? { record: blankRecord(wso, age, sex, weightClass), lifts: new Set<LiftName>() };
    classes.set(key, entry);
    if (entry.lifts.has(lift)) throw new Error(`New England ${describe()}: listed twice`);
    entry.lifts.add(lift);
    setLift(entry.record, lift, value, holder);
  });
  const incomplete = [...classes].filter(([, { lifts }]) => lifts.size !== Object.keys(LIFTS).length).map(([key]) => key);
  if (incomplete.length) throw new Error(`New England classes missing a lift: ${incomplete.join(', ')}`);
  if (!classes.size) throw new Error(`New England ${NEW_ENGLAND_RECORDS_COLLECTION} parsed 0 records`);
  return [...classes.values()].map(({ record }) => record);
}
