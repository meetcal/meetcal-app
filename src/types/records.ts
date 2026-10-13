export interface WeightClassRecord {
  weightClass: string;
  /** `null` (or `0`, as some tables answer) for a lift with no record set. */
  snatchRecord: number | null;
  cjRecord: number | null;
  totalRecord: number | null;
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
