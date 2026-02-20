export type Platform = 'Red' | 'White' | 'Blue' | 'Stars' | 'Stripes' | 'Rogue';

export interface LiftResult {
  memberId: string;
  name: string;
  age: number;
  club: string;
  gender: string;
  weightClass: string;
  entryTotal: number;
  adaptive: boolean;
  session?: {
    number: number;
    platform: Platform;
    date?: string;
    startTime?: string;
    weighInTime?: string;
    displayDate?: string;
  };
}

export interface SupabaseLiftResult {
  id: number;
  event_id: string;
  meet: string;
  date: string;
  name: string;
  age: number;
  body_weight: number;
  snatch1: number | null;
  snatch2: number | null;
  snatch3: number | null;
  snatch_best: number | null;
  cj1: number | null;
  cj2: number | null;
  cj3: number | null;
  cj_best: number | null;
  total: number | null;
}

export interface SupabaseBests {
  snatch_best: number | null;
  cj_best: number | null;
  total: number | null;
}

export type Gender = 'Men' | 'Women';
export type AgeGroup = 'Senior' | 'U25' | 'U23' | 'Junior' | 'U17' | 'U15' | 'U13' | 'Masters 35-39' | 'Masters 40-44' | 'Masters 45-49' | 'Masters 50-54' | 'Masters 55-59' | 'Masters 60-64' | 'Masters 65-69' | 'Masters 70-74' | 'Masters 75-79' | 'Masters 80-84' | 'Masters 85-89' | 'Masters +90'; 