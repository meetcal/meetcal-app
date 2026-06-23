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
      a: number;
      b: number;
    }[];
  };
}
