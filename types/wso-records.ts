export type Gender = "Men" | "Women";

export interface Filters {
  [key: string]: string;
  wso: string;
  gender: string;
  ageGroup: string;
}
