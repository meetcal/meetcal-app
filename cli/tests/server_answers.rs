#![cfg(test)]
mod support {
    pub(crate) mod bodies;
    pub(crate) mod server;
}

use std::process::{Command, Output};

use serde_json::{Value, json};
use support::bodies::request_bodies;
use support::server::{OK, Reply, reply, serve};

fn text(rows: Value) -> Reply {
    let body = json!({ "status": "success", "value": { "json": rows.to_string() } });
    reply(OK, None, body.to_string())
}

fn value(answer: Value) -> Reply {
    reply(
        OK,
        None,
        json!({ "status": "success", "value": answer }).to_string(),
    )
}

fn run(base_url: &str, args: &[&str]) -> Output {
    let scratch =
        std::env::temp_dir().join(format!("meetcal-server-answers-{}", std::process::id()));
    Command::new(env!("CARGO_BIN_EXE_meetcal"))
        .args(args)
        .env("MEETCAL_CONVEX_URL", base_url)
        .env("XDG_CONFIG_HOME", &scratch)
        .env("XDG_CACHE_HOME", &scratch)
        .env("MEETCAL_NO_UPDATE_CHECK", "1")
        .output()
        .expect("run meetcal")
}

fn record(federation: &str, gender: &str, age: &str, class: &str) -> Value {
    json!({
        "weight_class": class, "snatch_record": 100, "cj_record": 120, "total_record": 220,
        "gender": gender, "age_category": age, "record_type": federation
    })
}

#[test]
fn records_asks_the_server_for_one_table() {
    let (base_url, requests) = serve(vec![text(json!([
        record("USAW", "Women", "Senior", "71"),
        record("USAW", "Women", "Senior", "48"),
    ]))]);

    let output = run(
        &base_url,
        &[
            "records",
            "--age",
            "Senior",
            "--gender",
            "f",
            "--federation",
            "usaw",
            "--format",
            "csv",
        ],
    );

    assert_eq!(output.status.code(), Some(0), "{:?}", output);
    let printed = String::from_utf8(output.stdout).unwrap();
    assert!(
        printed.lines().nth(1).unwrap().starts_with("48kg,"),
        "{printed}"
    );
    let bodies = request_bodies(&requests);
    assert_eq!(bodies.len(), 1);
    assert_eq!(bodies[0]["path"], "reference:records");
    assert_eq!(
        bodies[0]["args"],
        json!({"federation": "usaw", "ageCategory": "Senior", "gender": "Women"})
    );
}

#[test]
fn records_matching_nothing_name_the_values_from_the_categories() {
    let (base_url, requests) = serve(vec![
        text(json!([])),
        text(json!([
            {"record_type": "IWF", "gender": "Men", "age_category": "Senior"},
            {"record_type": "USAW", "gender": "Men", "age_category": "Masters 35"},
            {"record_type": "USAW", "gender": "Men", "age_category": "Senior"},
        ])),
    ]);

    let output = run(
        &base_url,
        &[
            "records",
            "--age",
            "Seniors",
            "--gender",
            "Men",
            "--federation",
            "USAW",
        ],
    );

    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains(
            "No records for --age \"Seniors\" with --federation USAW --gender Men. Try one of: \
             Masters 35, Senior"
        ),
        "{stderr}"
    );
    assert_eq!(
        request_bodies(&requests)[1]["path"],
        "reference:recordCategories"
    );
}

#[test]
fn qualifying_totals_matching_nothing_name_the_values_from_the_categories() {
    let (base_url, requests) = serve(vec![
        text(json!([])),
        text(json!([
            {"event_name": "2027 Nationals", "gender": "Men", "age_category": "Junior"},
            {"event_name": "2027 Finals", "gender": "Men", "age_category": "Junior"},
        ])),
    ]);

    let output = run(
        &base_url,
        &[
            "qualifying-totals",
            "--age",
            "Junior",
            "--gender",
            "m",
            "--event",
            "2027 Worlds",
        ],
    );

    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("Try one of: 2027 Finals, 2027 Nationals"),
        "{stderr}"
    );
    let bodies = request_bodies(&requests);
    assert_eq!(
        bodies[0]["args"],
        json!({"event": "2027 Worlds", "ageCategory": "Junior", "gender": "Men"})
    );
    assert_eq!(bodies[1]["path"], "reference:qualifyingTotalCategories");
}

#[test]
fn attendance_asks_the_server_for_the_matching_names() {
    let (base_url, requests) = serve(vec![
        value(json!({"meets": [], "count": 0})),
        value(json!({"meets": ["A", "B"], "count": 120})),
    ]);

    let none = run(&base_url, &["attendance", "ohio", "", "wso", "-x", "open"]);
    let many = run(&base_url, &["attendance", "national"]);

    assert!(
        String::from_utf8_lossy(&none.stderr)
            .contains("No meet names contain \"ohio  wso\". Try fewer or shorter words."),
        "{:?}",
        none
    );
    assert!(
        String::from_utf8_lossy(&many.stderr).contains("120 meets contain \"national\""),
        "{:?}",
        many
    );
    let bodies = request_bodies(&requests);
    assert_eq!(bodies[0]["path"], "meets:namesMatching");
    assert_eq!(
        bodies[0]["args"],
        json!({"words": ["ohio", "wso"], "exclude": ["open"]})
    );
}

#[test]
fn a_start_list_read_again_is_revalidated_with_its_tag() {
    let rows = json!([{
        "adaptive": false, "age": 30, "club": "Test Barbell", "entry_total": 200,
        "gender": "Women", "name": "Ada", "session_number": 1, "session_platform": "Red",
        "weight_class": "64", "wso": "Florida"
    }]);
    let (base_url, requests) = serve(vec![
        value(json!({ "etag": "\"e1\"", "json": rows.to_string() })),
        value(json!({ "etag": "\"e1\"" })),
    ]);
    let cache = std::env::temp_dir().join(format!("meetcal-start-list-tag-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&cache);
    let run_cached = || {
        Command::new(env!("CARGO_BIN_EXE_meetcal"))
            .args(["meet", "Test Meet", "--no-bests", "--format", "csv"])
            .env("MEETCAL_CONVEX_URL", &base_url)
            .env("XDG_CONFIG_HOME", &cache)
            .env("XDG_CACHE_HOME", &cache)
            .env("MEETCAL_NO_UPDATE_CHECK", "1")
            .output()
            .expect("run meetcal")
    };

    let first = run_cached();
    let second = run_cached();

    assert_eq!(first.status.code(), Some(0), "{first:?}");
    assert_eq!(second.status.code(), Some(0), "{second:?}");
    assert_eq!(first.stdout, second.stdout);
    assert!(String::from_utf8_lossy(&first.stdout).contains("Ada"));
    let bodies = request_bodies(&requests);
    assert_eq!(bodies[0]["path"], "meets:athletesSessions");
    assert_eq!(bodies[0]["args"], json!({"meet": "Test Meet"}));
    assert_eq!(
        bodies[1]["args"],
        json!({"meet": "Test Meet", "ifNoneMatch": "\"e1\""})
    );
    std::fs::remove_dir_all(cache).unwrap();
}
