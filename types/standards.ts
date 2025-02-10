export type StandardRecord = {
  weightClass: string;
  a: number;
  b: number;
};

export type AgeGroupStandards = {
  men: StandardRecord[];
  women: StandardRecord[];
};

export type StandardsData = {
  u15: AgeGroupStandards;
  youth: AgeGroupStandards;
  junior: AgeGroupStandards;
  senior: AgeGroupStandards;
}; 