import { supabase } from '@/lib/supabase';
import { WorldRecord, WorldRecordDisplay } from '@/types/world-records';

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
    const { data, error } = await supabase
      .from('world_records')
      .select('weight_class,snatch_record,cj_record,total_record')
      .eq('gender', gender)
      .eq('age_category', ageCategory);

    if (error) {
      console.error('Error fetching world records:', error);
      throw error;
    }

    if (!data) {
      worldRecordsCache.set(cacheKey, []);
      return [];
    }

    // Transform the data to match display format
    const records: WorldRecordDisplay[] = (data as WorldRecord[]).map(record => ({
      weightClass: record.weight_class,
      snatchRecord: record.snatch_record,
      cjRecord: record.cj_record,
      totalRecord: record.total_record,
      isPlusClass: isPlusClass(record.weight_class),
      numericWeight: getNumericWeight(record.weight_class),
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
  const { data, error } = await supabase
    .from('world_records')
    .select('gender');

  if (error) {
    console.error('Error fetching genders:', error);
    throw error;
  }

  const uniqueGenders = [...new Set(data?.map(row => row.gender) || [])];
  return uniqueGenders.sort();
}

/**
 * Fetches available age categories from world_records table
 */
export async function fetchWorldRecordAgeCategories(): Promise<string[]> {
  const { data, error } = await supabase
    .from('world_records')
    .select('age_category');

  if (error) {
    console.error('Error fetching age categories:', error);
    throw error;
  }

  const uniqueAgeCategories = [...new Set(data?.map(row => row.age_category) || [])];
  return uniqueAgeCategories.sort();
}
