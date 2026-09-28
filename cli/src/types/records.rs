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
}
