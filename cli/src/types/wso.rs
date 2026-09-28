use std::fmt;

use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum Movement {
    Snatch,
    CleanAndJerk,
    Total,
}

impl Movement {
    pub fn rank(self) -> u8 {
        match self {
            Self::Snatch => 0,
            Self::CleanAndJerk => 1,
            Self::Total => 2,
        }
    }
}

impl fmt::Display for Movement {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Snatch => formatter.write_str("Snatch"),
            Self::CleanAndJerk => formatter.write_str("Clean & Jerk"),
            Self::Total => formatter.write_str("Total"),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct WSORecord {
    pub weight_class: String,
    pub snatch_record: Option<f64>,
    pub cj_record: Option<f64>,
    pub total_record: Option<f64>,
    pub gender: String,
    pub age_category: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AthleteRow {
    pub name: String,
    pub wso: Option<String>,
}

#[derive(Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClubPrDetail {
    pub name: String,
    pub movement: Movement,
    pub new_pr: f64,
    pub previous_pr: f64,
}

#[derive(Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClubMedalDetail {
    pub name: String,
    pub age: String,
    pub movement: Movement,
    pub place: usize,
    pub result: f64,
}
