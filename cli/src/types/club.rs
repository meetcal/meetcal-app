use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub(crate) struct ClubMeetStats {
    pub(crate) total_athletes: u64,
    pub(crate) gold_medals: u64,
    pub(crate) silver_medals: u64,
    pub(crate) bronze_medals: u64,
    pub(crate) total_prs: u64,
    pub(crate) perfect_6_for_6: u64,
    pub(crate) total_weight_lifted: f64,
    pub(crate) snatch_make_rate: u64,
    pub(crate) cj_make_rate: u64,
    pub(crate) combined_make_rate: u64,
    pub(crate) athlete_results: Vec<AthleteMeetResult>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AthleteMeetResult {
    pub(crate) name: String,
    pub(crate) weight_class: String,
    pub(crate) snatch_best: f64,
    pub(crate) cj_best: f64,
    pub(crate) total: f64,
    pub(crate) body_weight: f64,
    pub(crate) snatch_medal: Option<String>,
    pub(crate) cj_medal: Option<String>,
    pub(crate) total_medal: Option<String>,
    pub(crate) is_pr: bool,
    pub(crate) perfect_lifts: bool,
}
