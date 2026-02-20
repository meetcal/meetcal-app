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