export interface AthleteClub {
  member_id: string;
  name: string;
  club: string;
  meet: string;
}

export interface ClubMeetStats {
  totalAthletes: number;
  goldMedals: number;
  silverMedals: number;
  bronzeMedals: number;
  totalPRs: number;
  perfect6for6: number;
  totalWeightLifted: number;
  athleteResults: AthleteResult[];
}

export interface AthleteResult {
  id: number;
  event_id: string;
  meet: string;
  date: string;
  name: string;
  age: number;
  body_weight: number;
  snatch1: number;
  snatch2: number;
  snatch3: number;
  snatch_best: number;
  cj1: number;
  cj2: number;
  cj3: number;
  cj_best: number;
  total: number;
  gender?: string;
  weight_class?: string;
}

export interface AthleteInfo {
  name: string;
  age: number;
  gender: string;
  weight_class: string;
}

export interface AthleteWeightClass {
  name: string;
  weight_class: string;
}

export interface MeetStatus {
  name: string;
  status: string;
}
