use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub(crate) struct Record {
    pub(crate) weight_class: String,
    pub(crate) snatch_record: f64,
    pub(crate) cj_record: f64,
    pub(crate) total_record: f64,
    pub(crate) gender: String,
    pub(crate) age_category: String,
    pub(crate) record_type: String,
    #[serde(default)]
    pub(crate) snatch_by: Option<RecordHolder>,
    #[serde(default)]
    pub(crate) cj_by: Option<RecordHolder>,
    #[serde(default)]
    pub(crate) total_by: Option<RecordHolder>,
}

/// Who set a record lift ("Standard" while nobody has claimed it), and when and where when the
/// source says.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub(crate) struct RecordHolder {
    pub(crate) name: String,
    pub(crate) date: Option<String>,
    pub(crate) location: Option<String>,
}
