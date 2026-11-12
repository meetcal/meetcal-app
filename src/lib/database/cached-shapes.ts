import { isRecord } from '@/lib/is-record';
import type { AgeGroupRecords, RecordsData, WeightClassRecord } from '@/types/records';
import type { StandardsData } from '@/types/standards';

export type ReadCached<T> = (value: unknown) => T | undefined;

export function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function arrayOf<T>(readItem: ReadCached<T>): ReadCached<T[]> {
  return (value) => {
    if (!Array.isArray(value)) return undefined;
    const items: T[] = [];
    for (const item of value) {
      const read = readItem(item);
      if (read !== undefined) items.push(read);
    }
    return items;
  };
}

export function mapOf<T>(readValue: ReadCached<T>): ReadCached<Record<string, T>> {
  return (value) => {
    if (!isRecord(value)) return undefined;
    const out: Record<string, T> = {};
    for (const [key, entry] of Object.entries(value)) {
      const read = readValue(entry);
      if (read !== undefined) out[key] = read;
    }
    return out;
  };
}

export const readStringList: ReadCached<string[]> = arrayOf((value) =>
  typeof value === 'string' ? value : undefined,
);

function nullableLift(value: unknown): number | null {
  return finiteNumber(value);
}

const readWeightClassRecord: ReadCached<WeightClassRecord> = (value) => {
  if (!isRecord(value) || typeof value.weightClass !== 'string') return undefined;
  return {
    weightClass: value.weightClass,
    snatchRecord: nullableLift(value.snatchRecord),
    cjRecord: nullableLift(value.cjRecord),
    totalRecord: nullableLift(value.totalRecord),
  };
};

const readWeightClassRecords = arrayOf(readWeightClassRecord);

const readAgeGroupRecords: ReadCached<AgeGroupRecords> = (value) => {
  if (!isRecord(value)) return undefined;
  const men = readWeightClassRecords(value.Men);
  const women = readWeightClassRecords(value.Women);
  if (men === undefined || women === undefined) return undefined;
  return { Men: men, Women: women };
};

export const readRecordsData: ReadCached<RecordsData> = mapOf(readAgeGroupRecords);

export const readRecordsDataByKey: ReadCached<Record<string, RecordsData>> = mapOf(readRecordsData);

const readStandardRow: ReadCached<StandardsData[string][string][number]> = (value) => {
  if (!isRecord(value) || typeof value.weightClass !== 'string') return undefined;
  return { weightClass: value.weightClass, a: finiteNumber(value.a), b: finiteNumber(value.b) };
};

export const readStandardsData: ReadCached<StandardsData> = mapOf(mapOf(arrayOf(readStandardRow)));

const readWeightClassTotals = mapOf((value) => finiteNumber(value) ?? undefined);

const readGenderTotals: ReadCached<{
  Men: Record<string, number>;
  Women: Record<string, number>;
}> = (value) => {
  if (!isRecord(value)) return undefined;
  const men = readWeightClassTotals(value.Men);
  const women = readWeightClassTotals(value.Women);
  if (men === undefined || women === undefined) return undefined;
  return { Men: men, Women: women };
};

export const readQualifyingTotalsData = mapOf(mapOf(readGenderTotals));

export const readQualifyingTotalCategories = (value: unknown) => {
  if (!isRecord(value)) return undefined;
  const events = readStringList(value.events);
  const ageGroupsByEvent = mapOf(readStringList)(value.ageGroupsByEvent);
  if (events === undefined || ageGroupsByEvent === undefined) return undefined;
  return { events, ageGroupsByEvent };
};

export const readNationalRankings = arrayOf((value) => {
  if (!isRecord(value) || typeof value.name !== 'string') return undefined;
  const id = finiteNumber(value.id);
  const total = finiteNumber(value.total);
  if (id === null || total === null) return undefined;
  return { id, name: value.name, total };
});

export const readClubMeets = arrayOf((value) => {
  if (!isRecord(value) || typeof value.meet !== 'string' || value.meet.length === 0) return undefined;
  return { meet: value.meet, date: typeof value.date === 'string' ? value.date : null };
});

export const readClubMeetStats = (value: unknown) => {
  if (!isRecord(value)) return undefined;
  const totalAthletes = finiteNumber(value.totalAthletes);
  const goldMedals = finiteNumber(value.goldMedals);
  const silverMedals = finiteNumber(value.silverMedals);
  const bronzeMedals = finiteNumber(value.bronzeMedals);
  const totalPRs = finiteNumber(value.totalPRs);
  const perfect6for6 = finiteNumber(value.perfect6for6);
  const totalWeightLifted = finiteNumber(value.totalWeightLifted);
  const snatchMakeRate = finiteNumber(value.snatchMakeRate);
  const cjMakeRate = finiteNumber(value.cjMakeRate);
  const combinedMakeRate = finiteNumber(value.combinedMakeRate);
  if (
    totalAthletes === null || goldMedals === null || silverMedals === null || bronzeMedals === null ||
    totalPRs === null || perfect6for6 === null || totalWeightLifted === null ||
    snatchMakeRate === null || cjMakeRate === null || combinedMakeRate === null
  ) {
    return undefined;
  }
  return {
    totalAthletes,
    goldMedals,
    silverMedals,
    bronzeMedals,
    totalPRs,
    perfect6for6,
    totalWeightLifted,
    snatchMakeRate,
    cjMakeRate,
    combinedMakeRate,
  };
};

export const readUnknown: ReadCached<unknown> = (value) => value;
