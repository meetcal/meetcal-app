use serde::Deserialize;

use crate::types::records::RecordHolder;

#[derive(Debug, Deserialize)]
pub(crate) struct WSORecord {
    pub(crate) weight_class: String,
    pub(crate) snatch_record: Option<f64>,
    pub(crate) cj_record: Option<f64>,
    pub(crate) total_record: Option<f64>,
    #[serde(default)]
    pub(crate) snatch_by: Option<RecordHolder>,
    #[serde(default)]
    pub(crate) cj_by: Option<RecordHolder>,
    #[serde(default)]
    pub(crate) total_by: Option<RecordHolder>,
}
