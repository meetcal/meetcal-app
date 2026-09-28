export interface WeightClassRecord {
  weightClass: string;
  snatchRecord: number;
  cjRecord: number;
  totalRecord: number;
}

export type AgeGroupRecords = {
  Men: WeightClassRecord[];
  Women: WeightClassRecord[];
};

export type RecordsData = {
  [ageGroup: string]: AgeGroupRecords;
};

export type Federation = string;
export type Gender = "Men" | "Women";
export type AgeGroup = string; // Changed from specific union

export interface Filters {
  [key: string]: string;
  federation: Federation;
  gender: string;
  ageGroup: AgeGroup;
}
