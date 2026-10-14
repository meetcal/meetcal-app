//! The scores and guards `leaderboard` ranks by, checked against `tests/fixtures/scores.json`, which
//! the server's port (`convex/lib/leaderboard.ts`) is checked against too
//! (`convex-tests/leaderboard.test.ts`): a rule changed on one side fails the other side's test.
//!
//! After changing a rule in `stats.rs` (and the server's), regenerate the expected values with
//! `MEETCAL_UPDATE_FIXTURES=1 cargo test --test score_fixtures`.

use meetcal::types::lifting_results::LiftingResults;
use meetcal::utils::stats::{Division, plausible, row_qpoints, row_sinclair};
use serde_json::{Value, json};

const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/scores.json");

/// What `stats.rs` says of a row. Scores are written as text, the shortest form that reads back
/// as the same `f64` (`{:?}`): serde_json's default parser can be a bit off on 17-digit numbers,
/// and the comparison must be exact.
fn expected(row: &LiftingResults) -> Value {
    let division = Division::parse(&row.age);
    let score = |value: Option<f64>| value.map(|value| format!("{value:?}"));
    json!({
        "gender": division.gender.map(|gender| gender.label()),
        "category": division.category,
        "plausible": plausible(row),
        "sinclair": score(row_sinclair(row)),
        "qpoints": score(row_qpoints(row)),
    })
}

#[test]
fn the_shared_fixture_holds_what_stats_computes() {
    let text = std::fs::read_to_string(FIXTURE).expect("the score fixture");
    let mut fixture: Value = serde_json::from_str(&text).expect("the fixture is JSON");
    let entries = fixture["rows"].as_array_mut().expect("the fixture's rows");
    assert!(entries.len() > 200, "{} rows", entries.len());
    let update = std::env::var_os("MEETCAL_UPDATE_FIXTURES").is_some();
    for entry in entries.iter_mut() {
        let row: LiftingResults = serde_json::from_value(entry["row"].clone()).expect("a row");
        let computed = expected(&row);
        if update {
            entry["expected"] = computed;
        } else {
            assert_eq!(entry["expected"], computed, "{}", entry["row"]);
        }
    }
    if update {
        let lines: Vec<String> = entries.iter().map(Value::to_string).collect();
        let about = fixture["about"].to_string();
        std::fs::write(
            FIXTURE,
            format!(
                "{{\n\"about\": {about},\n\"rows\": [\n{}\n]\n}}\n",
                lines.join(",\n")
            ),
        )
        .expect("the fixture written");
    }
}

#[test]
fn the_fixture_covers_every_outcome() {
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(FIXTURE).unwrap()).unwrap();
    let expected: Vec<&Value> = fixture["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| &entry["expected"])
        .collect();
    let some = |field: &str| expected.iter().filter(|e| !e[field].is_null()).count();
    let count = |field: &str, value: Value| expected.iter().filter(|e| e[field] == value).count();
    assert!(some("sinclair") > 50 && some("qpoints") > 50);
    assert!(count("plausible", json!(false)) > 20 && count("plausible", json!(true)) > 50);
    assert!(count("gender", json!("Men")) > 0 && count("gender", json!("Women")) > 0);
    assert!(count("gender", Value::Null) > 0);
}
