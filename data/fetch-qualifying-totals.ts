import { supabase } from '@/lib/supabase';

export type QualifyingTotal = {
  id: number;
  eventName: string;
  gender: 'Men' | 'Women';
  ageCategory: string;
  weightClass: string;
  qualifyingTotal: number;
};

export type QualifyingTotalsData = {
  [eventName: string]: {
    [ageCategory: string]: {
      Men: { [weightClass: string]: number };
      Women: { [weightClass: string]: number };
    };
  };
};

/**
 * Fetches qualifying totals from Supabase. If eventName, ageCategory, gender, or weightClass are provided,
 * fetches only that subset. Otherwise, fetches all.
 */
export async function fetchQualifyingTotals(
  eventName?: string,
  ageCategory?: string,
  gender?: 'Men' | 'Women',
  weightClass?: string
): Promise<QualifyingTotalsData> {
  let query = supabase
    .from('qualifying_totals')
    .select('*');
  if (eventName) query = query.eq('event_name', eventName.trim());
  if (ageCategory) query = query.eq('age_category', ageCategory.trim());
  if (gender) query = query.eq('gender', gender.trim());
  if (weightClass) query = query.eq('weight_class', weightClass.trim());

  const { data, error } = await query;
  if (error) throw error;

  const result: QualifyingTotalsData = {};
  (data || []).forEach((row) => {
    const e = row.event_name; 
    const a = row.age_category; 
    const g = row.gender as 'Men' | 'Women'; 
    const w = row.weight_class; 
    if (!result[e]) result[e] = {};
    if (!result[e][a]) result[e][a] = { Men: {}, Women: {} };
    if (!result[e][a][g]) result[e][a][g] = {};
    result[e][a][g][w] = row.qualifying_total;
  });

  return result;
}
