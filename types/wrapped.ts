export interface LiftingResult {
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
  
  export interface WrappedStats {
    totalWeightLifted: number;
    totalMeets: number;
    makePercentage: number;
    bestSnatch: number;
    bestCleanJerk: number;
    bestTotal: number;
    averageTotal: number;
    topMeet: string;
    improvementFromFirst: number;
    consecutiveMakes: number;
    favoriteAttempt: string;
    yearRank: string;
  }