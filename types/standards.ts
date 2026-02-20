export type StandardRecord = {
  weightClass: string;
  a: number;
  b: number;
};

export type AgeGroupStandards = {
  men: StandardRecord[];
  women: StandardRecord[];
};

export type Gender = "men" | "women";
export type AgeGroup = "senior" | "junior" | "youth" | "u15";

export interface Filters {
  gender: Gender;
  ageGroup: AgeGroup;
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