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