use std::fmt;

use serde::Deserialize;

use crate::types::records::RecordHolder;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Movement {
    Snatch,
    CleanAndJerk,
    Total,
}

impl Movement {
    pub(crate) fn rank(self) -> u8 {
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

#[derive(Debug, PartialEq)]
pub(crate) struct ClubMedalDetail {
    pub(crate) name: String,
    pub(crate) age: String,
    pub(crate) movement: Movement,
    pub(crate) place: usize,
    pub(crate) result: f64,
}
