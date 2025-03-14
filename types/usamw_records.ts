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
  
  export type USAMWRecordsData = {
    "Masters 35-39": AgeGroupRecords;
    "Masters 40-44": AgeGroupRecords;
    "Masters 45-49": AgeGroupRecords;
    "Masters 50-54": AgeGroupRecords;
    "Masters 55-59": AgeGroupRecords;
    "Masters 60-64": AgeGroupRecords;
    "Masters 65-69": AgeGroupRecords;
    "Masters 70-74": AgeGroupRecords;
    "Masters 75-79": AgeGroupRecords;
    "Masters 80-84": AgeGroupRecords;
    "Masters 85-89": AgeGroupRecords;
    "Masters +90": AgeGroupRecords;
  }; 