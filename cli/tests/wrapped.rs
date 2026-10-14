mod support;

use std::path::PathBuf;

use clap::Parser;
use meetcal::commands::wrapped::{athlete_year, get_wrapped_from};
use meetcal::parser::{Cli, Commands};
use meetcal::types::wrapped::WrappedAnswer;
use meetcal::utils::access::Access;
use meetcal::utils::credentials::{self, Credentials};
use serde_json::json;
use support::{OK, authorizations, reply, request_bodies, request_paths, serve};

#[test]
fn parses_wrapped_with_default_year() {
    let cli = Cli::parse_from(["meetcal", "wrapped", "Maddisen Mohnsen"]);

    let Commands::Wrapped(args) = cli.command else {
        panic!("expected wrapped command");
    };

    assert_eq!(args.name, "Maddisen Mohnsen");
    assert_eq!(args.year, None);
}

#[test]
fn parses_wrapped_with_calendar_year() {
    let cli = Cli::parse_from(["meetcal", "wrapped", "Maddisen Mohnsen", "--year", "2025"]);

    let Commands::Wrapped(args) = cli.command else {
        panic!("expected wrapped command");
    };

    assert_eq!(args.year, Some(2025));
}

#[test]
fn rejects_wrapped_with_invalid_year() {
    assert!(Cli::try_parse_from(["meetcal", "wrapped", "Name", "--year", "0"]).is_err());
    assert!(Cli::try_parse_from(["meetcal", "wrapped", "Name", "--year", "year"]).is_err());
    // The server answers 1900 to 2100.
    assert!(Cli::try_parse_from(["meetcal", "wrapped", "Name", "--year", "2101"]).is_err());
}

/// The server's athlete answer as Convex's HTTP API writes it: every number a float.
const ATHLETE: &str = r#"{"status":"success","value":{"kind":"athlete","name":"Maddisen Mohnsen","stats":{"averageTotal":262.5,"bestCleanJerk":150.0,"bestSnatch":113.0,"bestTotal":263.0,"favoriteAttempt":1.0,"improvementFromFirst":1.0,"longestMakeStreak":8.0,"makePercentage":83.33333333333334,"topMeet":"2024 Carolinas WSO Championships","totalMeets":2.0,"totalWeightLifted":1275.0,"yearRank":"Rising Star"}}}"#;

/// A saved login in a fresh directory, so the test shows Wrapped sends neither it nor a pass.
fn saved_login(base_url: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("meetcal-wrapped-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let path = dir.join("credentials.json");
    credentials::save(
        &path,
        &Credentials {
            token: "jwt-1".to_string(),
            token_id: "tid-1".to_string(),
            expires_at: 4_102_444_800_000,
            deployment: base_url.to_string(),
        },
    )
    .unwrap();
    path
}

#[tokio::test]
async fn wrapped_is_a_public_read_of_the_exact_name() {
    let (base_url, requests) = serve(vec![reply(OK, None, ATHLETE)]);
    let login = saved_login(&base_url);
    let access = Access::from_file(login.clone());

    let answer = get_wrapped_from(&base_url, &access, "maddisen mohnsen", 2024)
        .await
        .unwrap();
    let (name, stats) = athlete_year("maddisen mohnsen", 2024, answer).unwrap();

    assert_eq!(name, "Maddisen Mohnsen");
    assert_eq!(stats.total_meets, 2);
    assert_eq!(stats.longest_make_streak, 8);
    assert_eq!(stats.favorite_attempt, Some(1));
    assert_eq!(stats.best_total, 263.0);
    // One request: no pass fetched, none sent, and no login.
    let bodies = request_bodies(&requests);
    assert_eq!(bodies.len(), 1);
    assert_eq!(bodies[0]["path"], "results:wrapped");
    assert_eq!(
        bodies[0]["args"],
        json!({ "query": "maddisen mohnsen", "year": 2024, "picked": true })
    );
    assert_eq!(authorizations(&requests), [None]);
    assert_eq!(request_paths(&requests), ["/api/query"]);
    let _ = std::fs::remove_dir_all(login.parent().unwrap());
}

#[tokio::test]
async fn wrapped_reads_an_answer_without_results() {
    let (base_url, _) = serve(vec![reply(
        OK,
        None,
        r#"{"status":"success","value":{"kind":"none","suggestions":["Jane Doe"]}}"#,
    )]);

    let answer = get_wrapped_from(&base_url, &Access::anonymous(), "Janet Doe", 2025)
        .await
        .unwrap();

    assert_eq!(
        answer,
        WrappedAnswer::NoResults {
            suggestions: vec!["Jane Doe".to_string()]
        }
    );
}
