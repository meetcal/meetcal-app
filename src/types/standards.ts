export type Gender = "men" | "women";
export type AgeGroup = "senior" | "junior" | "youth" | "u15";

export interface Filters {
  [key: string]: string;
  gender: string;
  ageGroup: string;
}

export interface StandardsData {
  [ageGroup: string]: {
    [gender: string]: {
      weightClass: string;
      /** `null` (or `0`, as U15's B standard answers) for no standard. */
      a: number | null;
      b: number | null;
    }[];
  };
}
