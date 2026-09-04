export type Platform = 'Red' | 'White' | 'Blue' | 'Stars' | 'Stripes' | 'Rogue';

export interface LiftResult {
  memberId: string;
  name: string;
  age: number;
  club: string;
  wso?: string;
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
  age: string | number;
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
