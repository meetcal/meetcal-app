use serde::Deserialize;

use super::lifting_results::LiftingResults;

#[derive(Debug, Deserialize)]
pub struct SearchResponse {
    pub matched_name: Option<String>,
    pub suggestions: Vec<String>,
    pub results: Vec<LiftingResults>,
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
    pub improvement_from_first: f64,
    pub consecutive_makes: usize,
    pub favorite_attempt: Option<usize>,
    pub year_rank: &'static str,
}
