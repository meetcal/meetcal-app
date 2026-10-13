use serde::Deserialize;

use super::lifting_results::LiftingResults;

#[derive(Debug, Deserialize)]
pub struct SearchResponse {
    pub matched_name: Option<String>,
    pub suggestions: Vec<String>,
    pub results: Vec<LiftingResults>,
    /// More results matched than the answer holds (it keeps the most recent).
    #[serde(default)]
    pub truncated: bool,
}

#[derive(Debug, PartialEq)]
pub struct WrappedStats {
    pub total_weight_lifted: f64,
    pub total_meets: usize,
    pub make_percentage: f64,
    pub best_snatch: f64,
    pub best_clean_jerk: f64,
    pub best_total: f64,
    pub average_total: f64,
    pub top_meet: Option<String>,
    /// First meet's total to the last meet's; `None` with fewer than two meets with a total.
    pub improvement_from_first: Option<f64>,
    pub consecutive_makes: usize,
    pub favorite_attempt: Option<usize>,
    pub year_rank: &'static str,
}
