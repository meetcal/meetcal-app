export interface WorldRecord {
  id: number;
  gender: string;
  age_category: string;
  weight_class: string;
  snatch_record: number;
  cj_record: number;
  total_record: number;
}

export interface WorldRecordDisplay {
  weightClass: string;
  snatchRecord: number;
  cjRecord: number;
  totalRecord: number;
  isPlusClass: boolean;
  numericWeight: number;
}
