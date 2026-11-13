use super::format::{NO_VALUE, format_us_date};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

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
    #[serde(default)]
    pub member_id: Option<String>,
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
    #[serde(default)]
    pub lifter_id: Option<String>,
    #[serde(flatten)]
    pub result: LiftResult,
}

impl std::ops::Deref for LiftingResult {
    type Target = LiftResult;

    fn deref(&self) -> &Self::Target {
        &self.result
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
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
    /// Without an exact name match these are every matching athlete's rows,
    /// so each carries its athlete's name.
    pub results: Vec<LiftingResult>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub(crate) struct AthleteQuery {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lifter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub membership: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub other: bool,
}

impl AthleteQuery {
    pub(crate) fn names_one_lifter(&self) -> bool {
        self.lifter.is_some() || self.membership.is_some() || self.other
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub(crate) struct LifterCard {
    pub id: String,
    pub name: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub(crate) struct LifterChoice {
    #[serde(flatten)]
    pub lifter: LifterCard,
    pub results: f64,
    pub latest_date: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(crate) enum AthleteAnswer {
    Results {
        lifter: Option<LifterCard>,
        json: String,
    },
    Choose {
        name: String,
        lifters: Vec<LifterChoice>,
        other_results: f64,
    },
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

/// A name folded for matching, as the server folds it (`normalizeName` in
/// `convex/lib/names.ts`): composed to Unicode NFC, so "José" typed as `é` or
/// as `e` + U+0301 is one name, with runs of whitespace as one space and
/// lowercased.
pub(crate) fn normalize(value: &str) -> String {
    icu_normalizer::ComposingNormalizerBorrowed::new_nfc()
        .normalize(value)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Most athletes offered to pick from when a name search matches several;
/// the list renders under the search, so it is capped (as the app's is).
pub(crate) const MAX_ATHLETE_CHOICES: usize = 8;

pub(crate) fn distinct_athletes(rows: &[LiftingResult]) -> BTreeMap<String, String> {
    let mut newest: BTreeMap<String, &LiftingResult> = BTreeMap::new();
    for row in rows {
        let key = normalize(&row.name);
        if key.is_empty() {
            continue;
        }
        match newest.get(&key) {
            Some(kept) if kept.date > row.date => {}
            _ => {
                newest.insert(key, row);
            }
        }
    }
    newest
        .into_iter()
        .map(|(key, row)| (key, row.name.trim().to_owned()))
        .collect()
}

pub(crate) fn attempt(value: f64) -> String {
    if value == 0.0 {
        NO_VALUE.to_owned()
    } else if value < 0.0 {
        format!("{}×", -value)
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::api::{queries, wire, wire_fixture};

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
    fn names_fold_like_the_servers_including_unicode_composition() {
        assert_eq!(normalize("  Ann   LEE "), "ann lee");
        assert_eq!(normalize("Jos\u{e9} Cruz"), normalize("Jose\u{301} Cruz"));
        assert_eq!(normalize("Jose\u{301}"), "jos\u{e9}");
    }

    fn named(name: &str, date: &str) -> LiftingResult {
        serde_json::from_value(serde_json::json!({
            "name": name, "meet": "Meet", "date": date, "age": "Senior", "body_weight": 70.0,
            "snatch1": 0.0, "snatch2": 0.0, "snatch3": 0.0, "snatch_best": 0.0,
            "cj1": 0.0, "cj2": 0.0, "cj3": 0.0, "cj_best": 0.0, "total": 0.0, "adaptive": false
        }))
        .unwrap()
    }

    #[test]
    fn distinct_athletes_are_folded_ordered_and_keep_the_newest_spelling_trimmed() {
        let rows = [
            named("John Smith", "2026-01-01"),
            named("Jos\u{e9} Smith", "2026-03-01"),
            named(" john  smith ", "2026-02-01"),
            named("Jose\u{301} Smith", "2026-01-01"),
            named("", "2026-04-01"),
        ];
        let athletes = distinct_athletes(&rows);
        assert_eq!(
            athletes.into_values().collect::<Vec<_>>(),
            ["john  smith", "Jos\u{e9} Smith"]
        );
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

    #[test]
    fn a_suggestion_query_omits_the_dates_and_a_dated_one_includes_both() {
        let query =
            serde_json::to_value(AthleteSearchQuery::suggestions("Test".to_owned())).unwrap();
        assert_eq!(query, serde_json::json!({"query": "Test"}));
        let dated = AthleteSearchQuery::between(
            "Test".to_owned(),
            "2026-01-01".to_owned(),
            "2026-12-31".to_owned(),
        );
        assert_eq!(
            serde_json::to_value(dated).unwrap(),
            serde_json::json!({"query": "Test", "startDate": "2026-01-01", "endDate": "2026-12-31"})
        );
    }

    #[test]
    fn the_meet_lists_read_the_servers_answers() {
        for (query, fixture) in [
            (queries::UPCOMING_MEETS, wire_fixture!("meets.list")),
            (queries::COMPLETED_MEETS, wire_fixture!("meets.completed")),
        ] {
            let meets: Vec<Vec<Meet>> = wire::read(query, fixture);
            assert!(meets.iter().flatten().all(|meet| !meet.name.is_empty()));
        }
        let upcoming: Vec<Vec<Meet>> =
            wire::read(queries::UPCOMING_MEETS, wire_fixture!("meets.list"));
        let maps: Vec<_> = upcoming
            .iter()
            .flatten()
            .map(|meet| meet.venue_map_pdf_url.is_some())
            .collect();
        assert_eq!(maps, [false, true]);
    }

    #[test]
    fn a_meets_schedule_roster_and_results_read_the_servers_answers() {
        let schedule: Vec<Vec<ScheduleRow>> =
            wire::read(queries::MEET_SCHEDULE, wire_fixture!("meets.schedule"));
        assert_eq!(schedule.concat().len(), 2);
        let athletes: Vec<Vec<Athlete>> =
            wire::read(queries::MEET_ATHLETES, wire_fixture!("meets.athletes"));
        let seated: Vec<_> = athletes
            .concat()
            .iter()
            .map(|athlete| (athlete.wso.is_some(), athlete.session_number))
            .collect();
        assert_eq!(
            seated,
            [(true, Some(1.0)), (false, Some(2.0)), (false, None)]
        );
        let results: Vec<Vec<LiftingResult>> =
            wire::read(queries::MEET_RESULTS, wire_fixture!("results.byMeet"));
        let totals: Vec<_> = results.concat().iter().map(|row| row.total).collect();
        assert_eq!(totals, [184.0, 200.0, 0.0]);
    }

    #[test]
    fn an_athlete_lookup_reads_the_servers_answers() {
        let answers: Vec<AthleteAnswer> =
            wire::read(queries::ATHLETE, wire_fixture!("results.athlete"));
        let shapes: Vec<_> = answers
            .iter()
            .map(|answer| match answer {
                AthleteAnswer::Choose {
                    lifters,
                    other_results,
                    ..
                } => (lifters.len(), *other_results, 0),
                AthleteAnswer::Results { lifter, json } => (
                    usize::from(lifter.is_some()),
                    0.0,
                    serde_json::from_str::<Vec<LiftingResult>>(json)
                        .expect("rows")
                        .len(),
                ),
            })
            .collect();
        assert_eq!(
            shapes,
            [
                (2, 1.0, 0),
                (1, 0.0, 1),
                (0, 0.0, 1),
                (1, 0.0, 2),
                (1, 0.0, 2)
            ]
        );
    }

    #[test]
    fn a_search_reads_the_servers_answers() {
        let answers: Vec<AthleteSearchResponse> =
            wire::read(queries::SEARCH, wire_fixture!("results.search"));
        let shapes: Vec<_> = answers
            .iter()
            .map(|answer| (answer.matched_name.is_some(), answer.results.len()))
            .collect();
        assert_eq!(shapes, [(true, 1), (false, 2), (false, 0)]);
    }
}
