use super::lifting_results::LiftingResults;
use super::wso::{ClubMedalDetail, ClubPrDetail};
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptStats {
    pub made: u32,
    pub missed: u32,
    pub total: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClubMeetPerformanceStats {
    pub total_athletes: u32,
    pub total_results: u32,
    pub avg_total: f64,
    pub avg_snatch: f64,
    pub avg_clean_jerk: f64,
    pub avg_body_weight: f64,
    pub snatch_make_rate: f64,
    pub cj_make_rate: f64,
    pub total_make_rate: f64,
    pub snatch_attempts: AttemptStats,
    pub cj_attempts: AttemptStats,
    pub snatch1_make_rate: f64,
    pub cj1_make_rate: f64,
    pub snatch1_attempts: AttemptStats,
    pub cj1_attempts: AttemptStats,
    pub posted_total: u32,
    pub posted_total_rate: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClubPrStats {
    pub snatch_prs: u32,
    pub cj_prs: u32,
    pub total_prs: u32,
    pub details: Vec<ClubPrDetail>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClubMedalCounts {
    pub total: u32,
    pub snatch: u32,
    pub cj: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClubMedalStats {
    pub total_medals: u32,
    pub snatch_medals: u32,
    pub cj_medals: u32,
    pub all_medals: u32,
    pub gold: u32,
    pub silver: u32,
    pub bronze: u32,
    pub details: Vec<ClubMedalDetail>,
    pub by_meet: HashMap<String, ClubMedalCounts>,
}

pub type ClubHistoricalResultsByName = HashMap<String, Vec<LiftingResults>>;
