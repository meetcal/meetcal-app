export type WeightClassRecord = {
  weightClass: string;
  snatchRecord: number;
  cjRecord: number;
  totalRecord: number;
};

export type AgeGroupRecords = {
  men: WeightClassRecord[];
  women: WeightClassRecord[];
};

export type RecordsData = {
  u13: AgeGroupRecords;
  u15: AgeGroupRecords;
  u17: AgeGroupRecords;
  junior: AgeGroupRecords;
  senior: AgeGroupRecords;
}; 