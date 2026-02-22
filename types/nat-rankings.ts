export type Gender = "Men" | "Women";

export interface FilterState {
  [key: string]: string;
  gender: string;
  ageGroup: string;
  weightClass: string;
};
