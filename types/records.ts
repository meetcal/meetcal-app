export type WeightClassRecord = {
  weightClass: string;
  snatchRecord: number;
  cjRecord: number;
  totalRecord: number;
};

export type RecordsData = {
  men: WeightClassRecord[];
  women: WeightClassRecord[];
}; 