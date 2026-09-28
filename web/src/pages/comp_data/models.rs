use super::format::format_us_date;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct Meet {
    pub end_date: String,
    pub name: String,
    pub start_date: String,
    pub time_zone: String,
    pub venue_city: String,
    pub venue_name: String,
    pub venue_state: String,
    pub venue_street: String,
    pub venue_zip: String,
    pub status: String,
    pub venue_map_pdf_url: Option<String>,
    pub venue_map_apple_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct ScheduleRow {
    pub date: String,
    pub platform: String,
    pub session_id: f64,
    pub start_time: String,
    pub weigh_in_time: String,
    pub weight_class: String,
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct Athlete {
    pub name: String,
    pub age: f64,
    pub club: String,
    pub wso: Option<String>,
    pub gender: String,
    pub weight_class: String,
    pub entry_total: f64,
    pub adaptive: bool,
    pub session_number: Option<f64>,
    pub session_platform: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct LiftResult {
    pub meet: String,
    pub date: String,
    pub age: String,
    pub body_weight: f64,
    pub snatch1: f64,
    pub snatch2: f64,
    pub snatch3: f64,
    pub snatch_best: f64,
    pub cj1: f64,
    pub cj2: f64,
    pub cj3: f64,
    pub cj_best: f64,
    pub total: f64,
    pub adaptive: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct LiftingResult {
    pub name: String,
    #[serde(flatten)]
    pub result: LiftResult,
}

impl std::ops::Deref for LiftingResult {
    type Target = LiftResult;

    fn deref(&self) -> &Self::Target {
        &self.result
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AthleteSearchQuery {
    pub query: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
}

impl AthleteSearchQuery {
    pub(crate) fn suggestions(query: String) -> Self {
        Self {
            query,
            start_date: None,
            end_date: None,
        }
    }

    pub(crate) fn between(query: String, start_date: String, end_date: String) -> Self {
        Self {
            query,
            start_date: Some(start_date),
            end_date: Some(end_date),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct AthleteSearchResponse {
    pub matched_name: Option<String>,
    pub suggestions: Vec<String>,
    pub results: Vec<LiftResult>,
}

#[derive(Clone, Serialize)]
pub(crate) struct MeetQuery {
    pub meet: String,
}

const HOUR_MS: f64 = 60.0 * 60.0 * 1000.0;

/// `meets:list` reads the meets starting within three months of `now`. The
/// hour is enough, and every visitor within it shares one cached answer.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub(crate) struct UpcomingMeetsQuery {
    pub now: f64,
}

impl UpcomingMeetsQuery {
    pub(crate) fn at(now_ms: f64) -> Self {
        Self {
            now: (now_ms / HOUR_MS).floor() * HOUR_MS,
        }
    }

    pub(crate) fn current() -> Self {
        Self::at(js_sys::Date::now())
    }
}

/// Who set a record lift, and when and where when the source says.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub(crate) struct RecordHolder {
    pub name: String,
    pub date: Option<String>,
    pub location: Option<String>,
}

impl RecordHolder {
    /// When and where, e.g. "June 1, 2025 · Columbus, OH"; `None` when the
    /// source gave neither.
    pub(crate) fn detail(&self) -> Option<String> {
        let parts = [
            self.date.as_deref().map(format_us_date),
            self.location.clone(),
        ]
        .into_iter()
        .flatten()
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>();
        (!parts.is_empty()).then(|| parts.join(" · "))
    }
}

pub(crate) fn normalize(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

pub(crate) fn attempt(value: f64) -> String {
    if value == 0.0 {
        "—".to_owned()
    } else if value < 0.0 {
        format!("{}×", -value)
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn holder(date: Option<&str>, location: Option<&str>) -> RecordHolder {
        RecordHolder {
            name: "Ada Lift".to_owned(),
            date: date.map(str::to_owned),
            location: location.map(str::to_owned),
        }
    }

    #[test]
    fn holder_detail_joins_the_date_and_place_it_has() {
        assert_eq!(
            holder(Some("2025-06-01"), Some("Columbus, OH"))
                .detail()
                .as_deref(),
            Some("June 1, 2025 · Columbus, OH")
        );
        assert_eq!(
            holder(Some("2025-06-01"), None).detail().as_deref(),
            Some("June 1, 2025")
        );
        assert_eq!(
            holder(None, Some("Columbus, OH")).detail().as_deref(),
            Some("Columbus, OH")
        );
        assert_eq!(holder(None, Some(" ")).detail(), None);
        assert_eq!(holder(None, None).detail(), None);
    }

    #[test]
    fn upcoming_meets_query_rounds_down_to_the_hour() {
        let hour = 3_600_000.0;
        assert_eq!(
            UpcomingMeetsQuery::at(5.0 * hour + 59_999.0).now,
            5.0 * hour
        );
        assert_eq!(UpcomingMeetsQuery::at(5.0 * hour).now, 5.0 * hour);
    }
}
