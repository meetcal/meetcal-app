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
  snatchMakeRate: number;
  cjMakeRate: number;
  combinedMakeRate: number;
}
