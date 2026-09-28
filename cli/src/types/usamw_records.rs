use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeightClassRecord {
    pub weight_class: String,
    pub snatch_record: i32,
    pub cj_record: i32,
    pub total_record: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgeGroupRecords {
    pub men: Vec<WeightClassRecord>,
    pub women: Vec<WeightClassRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsamwRecordsData {
    pub masters_35_39: AgeGroupRecords,
    pub masters_40_44: AgeGroupRecords,
    pub masters_45_49: AgeGroupRecords,
    pub masters_50_54: AgeGroupRecords,
    pub masters_55_59: AgeGroupRecords,
    pub masters_60_64: AgeGroupRecords,
    pub masters_65_69: AgeGroupRecords,
    pub masters_70_74: AgeGroupRecords,
    pub masters_75_79: AgeGroupRecords,
    pub masters_80_84: AgeGroupRecords,
    pub masters_85_89: AgeGroupRecords,
    pub masters_90_plus: AgeGroupRecords,
}
