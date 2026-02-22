type Gender = "Men" | "Women";
type Event = string;
type AgeGroup = string;

export interface Filters {
  [key: string]: string;
  event: Event;
  gender: string;
  ageGroup: AgeGroup;
}
