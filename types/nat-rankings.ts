export type Gender = "Men" | "Women";

export interface FilterState {
  gender: Gender;
  ageGroup: string;
  weightClass: string;
};