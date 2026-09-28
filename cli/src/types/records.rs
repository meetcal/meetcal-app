use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Record {
    pub weight_class: String,
    pub snatch_record: f64,
    pub cj_record: f64,
    pub total_record: f64,
    pub gender: String,
    pub age_category: String,
    pub record_type: String,
    #[serde(default)]
    pub snatch_by: Option<RecordHolder>,
    #[serde(default)]
    pub cj_by: Option<RecordHolder>,
    #[serde(default)]
    pub total_by: Option<RecordHolder>,
}

/// Who set a record lift ("Standard" while nobody has claimed it), and when and where when the
/// source says.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct RecordHolder {
    pub name: String,
    pub date: Option<String>,
    pub location: Option<String>,
}
