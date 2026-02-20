type Gender = "Men" | "Women";
type Event = string;
type AgeGroup = string;

export interface Filters {
    event: Event;
    gender: Gender;
    ageGroup: AgeGroup;
  }