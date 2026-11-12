use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};

use super::{Body, Query, QueryResponse, functions, queries, read_answer, read_function_value};
use crate::commands::elite::EliteAnswer;
use crate::commands::intl_rankings::Rankings;
use crate::commands::nat_ranking_year::NatRankingYear;
use crate::commands::nat_rankings::NatRanking;
use crate::commands::qual_totals::QualifyingTotal;
use crate::commands::standards::Standards;
use crate::types::athletes::Athletes;
use crate::types::club::ClubMeetStats;
use crate::types::lifting_results::{AdaptiveRecord, LiftingResults};
use crate::types::meets::{Meet, NamedBests, ScheduleRow};
use crate::types::records::Record;
use crate::types::wrapped::{SearchResponse, WrappedAnswer};
use crate::types::wso::WSORecord;
use crate::utils::access::{AccessPass, Refreshed};

macro_rules! wire_fixture {
    ($name:literal) => {
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../fixtures/wire/",
            $name,
            ".json"
        ))
    };
}

#[derive(Deserialize)]
struct Fixture {
    function: String,
    encoding: String,
    answers: Vec<Answer>,
}

#[derive(Deserialize)]
struct Answer {
    body: Value,
}

fn as_convex_sends(value: Value) -> Value {
    match value {
        Value::Number(number) => number
            .as_f64()
            .filter(|_| !number.is_f64())
            .map_or(Value::Number(number), Value::from),
        Value::Array(items) => items.into_iter().map(as_convex_sends).collect(),
        Value::Object(fields) => fields
            .into_iter()
            .map(|(key, field)| (key, as_convex_sends(field)))
            .collect(),
        other @ (Value::Null | Value::Bool(_) | Value::String(_)) => other,
    }
}

fn answers(function: &str, body: Body, fixture: &str) -> Vec<Value> {
    let fixture: Fixture = serde_json::from_str(fixture).unwrap();
    assert_eq!(fixture.function, function);
    let encoding = match body {
        Body::Value => "value",
        Body::JsonText => "jsonText",
    };
    assert_eq!(fixture.encoding, encoding, "{function}");
    fixture
        .answers
        .into_iter()
        .map(|answer| match body {
            Body::Value => as_convex_sends(answer.body),
            Body::JsonText => {
                json!({ "etag": "\"wire-fixture\"", "json": answer.body.to_string() })
            }
        })
        .collect()
}

fn read<T: DeserializeOwned>(query: Query, fixture: &str) -> Vec<T> {
    answers(query.function, query.body, fixture)
        .into_iter()
        .map(|value| read_answer(query, QueryResponse::Success { value }).unwrap())
        .collect()
}

fn read_function<T: DeserializeOwned>(function: &str, fixture: &str) -> Vec<T> {
    answers(function, Body::Value, fixture)
        .into_iter()
        .map(|value| read_function_value(function, value).unwrap())
        .collect()
}

#[test]
fn meets_read_the_servers_answers() {
    let upcoming: Vec<Vec<Meet>> = read(queries::UPCOMING_MEETS, wire_fixture!("meets.list"));
    let maps: Vec<_> = upcoming
        .iter()
        .flatten()
        .map(|meet| meet.venue_map_pdf_url.is_some())
        .collect();
    assert_eq!(maps, [false, true]);
    let completed: Vec<Vec<Meet>> =
        read(queries::COMPLETED_MEETS, wire_fixture!("meets.completed"));
    assert_eq!(completed.iter().flatten().count(), 1);
    let details: Vec<Meet> = read(queries::MEET_DETAILS, wire_fixture!("meets.details"));
    let federations: Vec<_> = details
        .iter()
        .map(|meet| meet.federation.as_str())
        .collect();
    assert_eq!(federations, ["USAW", ""]);
    let schedule: Vec<Vec<ScheduleRow>> =
        read(queries::MEET_SCHEDULE, wire_fixture!("meets.schedule"));
    assert_eq!(schedule.iter().flatten().count(), 2);
}

#[test]
fn rosters_read_the_servers_answers() {
    let roster: Vec<Vec<Athletes>> = read(queries::MEET_ATHLETES, wire_fixture!("meets.athletes"));
    let seated: Vec<_> = roster
        .iter()
        .flatten()
        .map(|athlete| (athlete.wso.is_some(), athlete.session_number))
        .collect();
    assert_eq!(
        seated,
        [(true, Some(1.0)), (false, Some(2.0)), (false, None)]
    );
    let sessions: Vec<Vec<Athletes>> = read(
        queries::MEET_ATHLETES_SESSIONS,
        wire_fixture!("meets.athletesSessions"),
    );
    let dates: Vec<_> = sessions
        .iter()
        .map(|rows| rows.iter().filter(|athlete| athlete.date.is_some()).count())
        .collect();
    assert_eq!(dates, [2, 1]);
}

#[test]
fn results_read_the_servers_answers() {
    for (query, fixture) in [
        (queries::MEET_RESULTS, wire_fixture!("results.byMeet")),
        (queries::RESULTS_BY_NAMES, wire_fixture!("results.byNames")),
        (queries::RECENT_RESULTS, wire_fixture!("results.recent")),
    ] {
        let rows: Vec<Vec<LiftingResults>> = read(query, fixture);
        assert!(
            rows.iter().flatten().all(|row| !row.name.is_empty()),
            "{}",
            query.function
        );
    }
    let bests: Vec<Vec<NamedBests>> = read(queries::BESTS, wire_fixture!("results.bests"));
    let totals: Vec<_> = bests.iter().flatten().map(|row| row.best_total).collect();
    assert_eq!(totals, [184.0, 0.0]);
    let searches: Vec<SearchResponse> = read(queries::SEARCH, wire_fixture!("results.search"));
    let shapes: Vec<_> = searches
        .iter()
        .map(|answer| (answer.matched_name.is_some(), answer.results.len()))
        .collect();
    assert_eq!(shapes, [(true, 1), (false, 2), (false, 0)]);
}

#[test]
fn every_kind_of_wrapped_answer_reads_the_servers_answer() {
    let answers: Vec<WrappedAnswer> = read(queries::WRAPPED, wire_fixture!("results.wrapped"));
    let kinds: Vec<_> = answers
        .iter()
        .map(|answer| match answer {
            WrappedAnswer::Athlete { .. } => "athlete",
            WrappedAnswer::Ambiguous { .. } => "ambiguous",
            WrappedAnswer::Narrow => "narrow",
            WrappedAnswer::TooManyResults { .. } => "tooManyResults",
            WrappedAnswer::NoResults { .. } => "none",
        })
        .collect();
    assert_eq!(
        kinds,
        [
            "athlete",
            "ambiguous",
            "athlete",
            "none",
            "tooManyResults",
            "narrow"
        ]
    );
}

#[test]
fn elite_lists_read_the_servers_answer() {
    let answers: Vec<EliteAnswer> = read_function(
        functions::WSO_ELITE.function,
        wire_fixture!("results.wsoElite"),
    );
    let shapes: Vec<_> = answers
        .iter()
        .map(|answer| (answer.members, answer.lists.overall.women.len()))
        .collect();
    assert_eq!(shapes, [(2, 1)]);
}

#[test]
fn reference_tables_read_the_servers_answers() {
    let records: Vec<Vec<Record>> = read(queries::RECORDS, wire_fixture!("reference.records"));
    let totals: Vec<_> = records
        .iter()
        .flatten()
        .map(|row| row.total_record)
        .collect();
    assert_eq!(totals, [250.0, 260.0]);
    let standards: Vec<Vec<Standards>> =
        read(queries::STANDARDS, wire_fixture!("reference.standards"));
    assert_eq!(standards.iter().flatten().count(), 2);
    let totals: Vec<Vec<QualifyingTotal>> = read(
        queries::QUALIFYING_TOTALS,
        wire_fixture!("reference.qualifyingTotals"),
    );
    assert_eq!(totals.iter().flatten().count(), 2);
    let rankings: Vec<Vec<Rankings>> = read(
        queries::INTL_RANKINGS,
        wire_fixture!("reference.intlRankings"),
    );
    assert_eq!(rankings.iter().flatten().count(), 1);
    let national: Vec<Vec<NatRanking>> = read(
        queries::NATIONAL_RANKINGS,
        wire_fixture!("reference.nationalRankings"),
    );
    assert_eq!(national.iter().flatten().count(), 2);
    let by_year: Vec<Vec<NatRankingYear>> = read(
        queries::NATIONAL_RANKINGS_BY_YEAR,
        wire_fixture!("reference.nationalRankingsByYear"),
    );
    let dates: Vec<_> = by_year
        .iter()
        .flatten()
        .map(|row| row.date.clone())
        .collect();
    assert_eq!(dates, ["2026-03-07", "2026-01-01"]);
    let wso: Vec<Vec<WSORecord>> =
        read(queries::WSO_RECORDS, wire_fixture!("reference.wsoRecords"));
    let lifts: Vec<_> = wso
        .iter()
        .flatten()
        .map(|row| (row.cj_record, row.total_by.is_some()))
        .collect();
    assert_eq!(lifts, [(Some(118.0), true), (None, false)]);
    let adaptive: Vec<Vec<AdaptiveRecord>> = read(
        queries::ADAPTIVE_RECORDS,
        wire_fixture!("reference.adaptiveRecords"),
    );
    assert_eq!(adaptive.iter().flatten().count(), 1);
}

#[test]
fn name_lists_read_the_servers_answers() {
    for (query, fixture) in [
        (queries::CLUBS, wire_fixture!("reference.clubs")),
        (queries::WSO_LIST, wire_fixture!("reference.wsoList")),
        (
            queries::REGISTRATION_WSOS,
            wire_fixture!("reference.registrationWsos"),
        ),
        (
            queries::WSO_AGE_GROUPS,
            wire_fixture!("reference.wsoAgeGroups"),
        ),
    ] {
        let names: Vec<Vec<String>> = read(query, fixture);
        assert!(
            names.iter().all(|list| !list.is_empty()),
            "{}",
            query.function
        );
    }
}

#[test]
fn club_meet_stats_read_the_servers_answer() {
    let stats: Vec<ClubMeetStats> = read(
        queries::CLUB_MEET_STATS,
        wire_fixture!("reference.clubMeetStats"),
    );
    let shapes: Vec<_> = stats
        .iter()
        .map(|stats| (stats.total_athletes, stats.athlete_results.len()))
        .collect();
    assert_eq!(shapes, [(3, 3)]);
}

#[test]
fn the_login_calls_read_the_servers_answers() {
    let passes: Vec<AccessPass> = read(queries::ACCESS_PASS, wire_fixture!("accessPass.pass"));
    let passes: Vec<_> = passes.iter().map(|pass| pass.pass.as_str()).collect();
    assert_eq!(passes, ["fixture-pass"]);
    let refreshed: Vec<Refreshed> = read_function(
        functions::REFRESH_ENTITLEMENT,
        wire_fixture!("entitlements.refresh"),
    );
    assert!(refreshed.iter().all(|answer| answer.active));
    let revoked: Vec<Value> =
        read_function(functions::REVOKE_TOKEN, wire_fixture!("apiTokens.revoke"));
    assert_eq!(revoked, [Value::Null]);
}
