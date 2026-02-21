import { convex } from '@/lib/convex';
import { api } from '@/convex/_generated/api';
import { WorldRecordDisplay } from '@/types/world-records';

const worldRecordsCache = new Map<string, WorldRecordDisplay[]>();
const worldRecordsInFlight = new Map<string, Promise<WorldRecordDisplay[]>>();

/**
 * Helper function to determine if a weight class contains a "+" sign
 */
function isPlusClass(weightClass: string): boolean {
  return weightClass.includes('+');
}

/**
 * Helper function to extract the numeric weight from a weight class string
 */
function getNumericWeight(weightClass: string): number {
  const digits = weightClass.replace(/\D/g, '');
  return parseInt(digits) || 0;
}

/**
 * Custom sort function for weight classes: numeric ascending, '+' classes last
 */
function sortWorldRecords(a: WorldRecordDisplay, b: WorldRecordDisplay): number {
  if (a.isPlusClass !== b.isPlusClass) {
    return a.isPlusClass ? 1 : -1;
  }
  if (a.numericWeight !== b.numericWeight) {
    return a.numericWeight - b.numericWeight;
  }
  return a.weightClass.localeCompare(b.weightClass);
}

/**
 * Fetches IWF World Records from Supabase for a given gender and age category
 */
export async function fetchWorldRecords(
  gender: string,
  ageCategory: string
): Promise<WorldRecordDisplay[]> {
  const cacheKey = `${gender}::${ageCategory}`;
  const cached = worldRecordsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const inFlight = worldRecordsInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    const rows = await convex.query(api.worldRecords.getByGenderAndAge, { gender, ageCategory });

    if (!rows || rows.length === 0) {
      worldRecordsCache.set(cacheKey, []);
      return [];
    }

    // Transform the data to match display format
    const records: WorldRecordDisplay[] = rows.map(record => ({
      weightClass: record.weightClass,
      snatchRecord: record.snatchRecord ?? 0,
      cjRecord: record.cjRecord ?? 0,
      totalRecord: record.totalRecord ?? 0,
      isPlusClass: isPlusClass(record.weightClass),
      numericWeight: getNumericWeight(record.weightClass),
    }));

    // Sort records
    records.sort(sortWorldRecords);
    worldRecordsCache.set(cacheKey, records);
    return records;
  })().finally(() => {
    worldRecordsInFlight.delete(cacheKey);
  });

  worldRecordsInFlight.set(cacheKey, request);
  return request;
}

/**
 * Fetches available genders from world_records table
 */
export async function fetchWorldRecordGenders(): Promise<string[]> {
  const rows = await convex.query(api.worldRecords.getAll, {});
  const uniqueGenders = [...new Set(rows.map(row => row.gender))].filter(Boolean);
  return uniqueGenders.sort();
}

/**
 * Fetches available age categories from world_records table
 */
export async function fetchWorldRecordAgeCategories(): Promise<string[]> {
  const rows = await convex.query(api.worldRecords.getAll, {});
  const uniqueAgeCategories = [...new Set(rows.map(row => row.ageCategory))].filter(Boolean);
  return uniqueAgeCategories.sort();
}
