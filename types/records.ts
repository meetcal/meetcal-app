export interface WeightClassRecord {
  weightClass: string;
  snatchRecord: number;
  cjRecord: number;
  totalRecord: number;
}

export type AgeGroupRecords = {
  men: WeightClassRecord[];
  women: WeightClassRecord[];
};

export type RecordsData = {
  [ageGroup: string]: AgeGroupRecords;
}; 