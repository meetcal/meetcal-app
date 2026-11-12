import { nullableNumber, nullableString, validateRows, validateStringList } from '@/lib/api/api-validators';
import { copiedList, freshValue, getRevalidated, revalidateTagged, type TaggedAnswer } from '@/lib/api/revalidated-reads';

export type ApiRecordRow = {
  age_category: string | null;
  gender: string | null;
  weight_class: string | null;
  record_type: string | null;
  snatch_record: number | null;
  cj_record: number | null;
  total_record: number | null;
};

export type ApiStandardRow = {
  age_category: string | null;
  gender: string | null;
  weight_class: string | null;
  standard_a: number | null;
  standard_b: number | null;
};

export type ApiQualifyingTotalRow = {
  event_name: string | null;
  age_category: string | null;
  gender: string | null;
  weight_class: string | null;
  qualifying_total: number | null;
};

export type ApiIntlRankingRow = {
  meet: string | null;
  ranking: number | null;
  name: string | null;
  weight_class: string | null;
  total: number | null;
  percent_a: number | null;
  gender: string | null;
  age_category: string | null;
};

export type ApiNationalRankingRow = {
  name: string | null;
  total: number | null;
};

export type ApiWsoRecordRow = {
  wso: string | null;
  age_category: string | null;
  gender: string | null;
  weight_class: string | null;
  snatch_record: number | null;
  cj_record: number | null;
  total_record: number | null;
};

export type ApiAdaptiveRecordRow = {
  weight_class: string | null;
  snatch: number | null;
  cj: number | null;
  total: number | null;
};

function validateApiRecords(json: unknown): readonly Readonly<ApiRecordRow>[] {
  return validateRows(json, '/data/records', (row) => ({
    age_category: nullableString(row.age_category),
    gender: nullableString(row.gender),
    weight_class: nullableString(row.weight_class),
    record_type: nullableString(row.record_type),
    snatch_record: nullableNumber(row.snatch_record),
    cj_record: nullableNumber(row.cj_record),
    total_record: nullableNumber(row.total_record),
  }));
}

function validateApiStandards(json: unknown): readonly Readonly<ApiStandardRow>[] {
  return validateRows(json, '/data/standards', (row) => ({
    age_category: nullableString(row.age_category),
    gender: nullableString(row.gender),
    weight_class: nullableString(row.weight_class),
    standard_a: nullableNumber(row.standard_a),
    standard_b: nullableNumber(row.standard_b),
  }));
}

function validateApiQualifyingTotals(
  json: unknown,
): readonly Readonly<ApiQualifyingTotalRow>[] {
  return validateRows(json, '/data/qualifying-totals', (row) => ({
    event_name: nullableString(row.event_name),
    age_category: nullableString(row.age_category),
    gender: nullableString(row.gender),
    weight_class: nullableString(row.weight_class),
    qualifying_total: nullableNumber(row.qualifying_total),
  }));
}

function validateApiIntlRankings(json: unknown): readonly Readonly<ApiIntlRankingRow>[] {
  return validateRows(json, '/data/intl-rankings', (row) => ({
    meet: nullableString(row.meet),
    ranking: nullableNumber(row.ranking),
    name: nullableString(row.name),
    weight_class: nullableString(row.weight_class),
    total: nullableNumber(row.total),
    percent_a: nullableNumber(row.percent_a),
    gender: nullableString(row.gender),
    age_category: nullableString(row.age_category),
  }));
}

function validateApiNationalRankings(
  json: unknown,
): readonly Readonly<ApiNationalRankingRow>[] {
  return validateRows(json, '/data/nat-rankings', (row) => ({
    name: nullableString(row.name),
    total: nullableNumber(row.total),
  }));
}

function validateApiWsoRecords(json: unknown): readonly Readonly<ApiWsoRecordRow>[] {
  return validateRows(json, '/data/wso/records', (row) => ({
    wso: nullableString(row.wso),
    age_category: nullableString(row.age_category),
    gender: nullableString(row.gender),
    weight_class: nullableString(row.weight_class),
    snatch_record: nullableNumber(row.snatch_record),
    cj_record: nullableNumber(row.cj_record),
    total_record: nullableNumber(row.total_record),
  }));
}

function validateApiAdaptiveRecords(
  json: unknown,
): readonly Readonly<ApiAdaptiveRecordRow>[] {
  return validateRows(json, '/data/adaptive', (row) => ({
    weight_class: nullableString(row.weight_class),
    snatch: nullableNumber(row.snatch),
    cj: nullableNumber(row.cj),
    total: nullableNumber(row.total),
  }));
}

type Rows<T> = readonly Readonly<T>[];

export function fetchApiRecordsTagged(knownTag: string | null): Promise<TaggedAnswer<Rows<ApiRecordRow>>> {
  return revalidateTagged('/data/records', 'reference:records', {}, validateApiRecords, { knownTag });
}

export async function fetchApiRecords(): Promise<Rows<ApiRecordRow>> {
  return freshValue(await fetchApiRecordsTagged(null), '/data/records');
}

export function fetchApiStandardsTagged(knownTag: string | null): Promise<TaggedAnswer<Rows<ApiStandardRow>>> {
  return revalidateTagged('/data/standards', 'reference:standards', {}, validateApiStandards, { knownTag });
}

export async function fetchApiStandards(): Promise<Rows<ApiStandardRow>> {
  return freshValue(await fetchApiStandardsTagged(null), '/data/standards');
}

export function fetchApiQualifyingTotalsTagged(
  knownTag: string | null,
): Promise<TaggedAnswer<Rows<ApiQualifyingTotalRow>>> {
  return revalidateTagged(
    '/data/qualifying-totals',
    'reference:qualifyingTotals',
    {},
    validateApiQualifyingTotals,
    { knownTag },
  );
}

export async function fetchApiQualifyingTotals(): Promise<Rows<ApiQualifyingTotalRow>> {
  return freshValue(await fetchApiQualifyingTotalsTagged(null), '/data/qualifying-totals');
}

export function fetchApiIntlRankingsTagged(knownTag: string | null): Promise<TaggedAnswer<Rows<ApiIntlRankingRow>>> {
  return revalidateTagged('/data/intl-rankings', 'reference:intlRankings', {}, validateApiIntlRankings, { knownTag });
}

export async function fetchApiIntlRankings(): Promise<Rows<ApiIntlRankingRow>> {
  return freshValue(await fetchApiIntlRankingsTagged(null), '/data/intl-rankings');
}

export function fetchApiNationalRankingsTagged(
  knownTag: string | null,
  federation: string,
  ageCategory: string,
): Promise<TaggedAnswer<Rows<ApiNationalRankingRow>>> {
  return revalidateTagged(
    '/data/nat-rankings',
    'reference:nationalRankings',
    { federation, ageCategory },
    validateApiNationalRankings,
    { knownTag },
  );
}

export async function fetchApiNationalRankings(
  federation: string,
  ageCategory: string,
): Promise<Rows<ApiNationalRankingRow>> {
  return freshValue(await fetchApiNationalRankingsTagged(null, federation, ageCategory), '/data/nat-rankings');
}

export function fetchApiWsoRecordsTagged(
  knownTag: string | null,
  wso: string,
  ageCategory?: string,
  gender?: string,
): Promise<TaggedAnswer<Rows<ApiWsoRecordRow>>> {
  return revalidateTagged(
    '/data/wso/records',
    'reference:wsoRecords',
    { wso, ageCategory, gender },
    validateApiWsoRecords,
    { knownTag },
  );
}

export async function fetchApiWsoRecords(
  wso: string,
  ageCategory?: string,
  gender?: string,
): Promise<Rows<ApiWsoRecordRow>> {
  return freshValue(await fetchApiWsoRecordsTagged(null, wso, ageCategory, gender), '/data/wso/records');
}

export function fetchApiAdaptiveRecordsTagged(
  knownTag: string | null,
  gender: string,
  excludeFederation: string,
): Promise<TaggedAnswer<Rows<ApiAdaptiveRecordRow>>> {
  return revalidateTagged(
    '/data/adaptive',
    'reference:adaptiveRecords',
    { excludeFederation, gender },
    validateApiAdaptiveRecords,
    { knownTag },
  );
}

export async function fetchApiAdaptiveRecords(
  gender: string,
  excludeFederation: string,
): Promise<Rows<ApiAdaptiveRecordRow>> {
  return freshValue(await fetchApiAdaptiveRecordsTagged(null, gender, excludeFederation), '/data/adaptive');
}

export async function fetchApiWsoListTagged(knownTag: string | null): Promise<TaggedAnswer<string[]>> {
  return copiedList(
    await revalidateTagged('/data/wso/', 'reference:wsoList', {}, (json) => validateStringList(json, '/data/wso/'), {
      knownTag,
    }),
  );
}

export async function fetchApiWsoList(): Promise<string[]> {
  return freshValue(await fetchApiWsoListTagged(null), '/data/wso/');
}

export async function fetchApiWsoAgeGroups(wso: string): Promise<string[]> {
  return [
    ...(await getRevalidated('/data/wso/age-groups', 'reference:wsoAgeGroups', { wso }, (json) =>
      validateStringList(json, '/data/wso/age-groups'),
    )),
  ];
}
