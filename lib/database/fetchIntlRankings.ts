// You may want to import your supabase instance instead if you have a shared one
import { supabase } from '../supabase';

export type IntlRanking = {
  meet: string | null;
  ranking: number | null;
  name: string | null;
  weight_class: string | null;
  total: number | null;
  percent_a: number | null;
  gender: 'Men' | 'Women' | null;
  age_category: 'Senior' | 'Junior' | 'Youth' | 'U17' | 'U15' | null;
};

// Basic fetch function (add filters later)
export async function fetchIntlRankings(): Promise<IntlRanking[]> {
  const { data, error } = await supabase
    .from('intl_rankings')
    .select('*');

  if (error) {
    throw error;
  }

  return data as IntlRanking[];
}
