use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct ClubMeetStats {
    pub total_athletes: u64,
    pub gold_medals: u64,
    pub silver_medals: u64,
    pub bronze_medals: u64,
    pub total_prs: u64,
    pub perfect_6_for_6: u64,
    pub total_weight_lifted: f64,
    pub snatch_make_rate: u64,
    pub cj_make_rate: u64,
    pub combined_make_rate: u64,
    pub athlete_results: Vec<AthleteMeetResult>,
}

#[derive(Debug, Deserialize)]
pub struct AthleteMeetResult {
    pub name: String,
    pub weight_class: String,
    pub snatch_best: f64,
    pub cj_best: f64,
    pub total: f64,
    pub body_weight: f64,
    pub medal: Option<String>,
    pub snatch_medal: Option<String>,
    pub cj_medal: Option<String>,
    pub total_medal: Option<String>,
    pub is_pr: bool,
    pub perfect_lifts: bool,
}
