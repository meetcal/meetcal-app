type Event = string;
type AgeGroup = string;

export interface QualifyingTotalsFilters {
  [key: string]: string;
  event: Event;
  gender: string;
  ageGroup: AgeGroup;
}
