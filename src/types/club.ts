export interface AthleteClub {
  member_id: string;
  name: string;
  club: string;
  meet: string;
  /** The meet's first day (`YYYY-MM-DD`); absent from answers and caches from before it was sent. */
  meet_date?: string | null;
}

export interface ClubMeetStats {
  totalAthletes: number;
  goldMedals: number;
  silverMedals: number;
  bronzeMedals: number;
  totalPRs: number;
  perfect6for6: number;
  totalWeightLifted: number;
  snatchMakeRate: number;
  cjMakeRate: number;
  combinedMakeRate: number;
}
