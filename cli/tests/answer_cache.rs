#![cfg(test)]

mod support {
    pub(crate) mod bodies;
    pub(crate) mod server;
}

use std::path::{Path, PathBuf};

use meetcal::commands::login::logout;
use meetcal::utils::access::Access;
use meetcal::utils::backend::{queries, query_from};
use meetcal::utils::cache::Cache;
use meetcal::utils::credentials::{self, Credentials};
use serde_json::{Value, json};
use support::bodies::request_bodies;
use support::server::{OK, reply, serve};

const FAR_FUTURE: i64 = 4_102_444_800_000;

fn scratch(test: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "meetcal-answer-cache-{test}-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

fn saved_login(dir: &Path, deployment: &str) -> PathBuf {
    let path = dir.join("config").join("credentials.json");
    credentials::save(
        &path,
        &Credentials {
            token: "jwt-1".to_string(),
            token_id: "tid-1".to_string(),
            expires_at: FAR_FUTURE,
            deployment: deployment.to_string(),
        },
    )
    .unwrap();
    path
}

fn tagged(etag: &str, rows: &str) -> String {
    json!({"status": "success", "value": {"etag": etag, "json": rows}}).to_string()
}

fn unchanged(etag: &str) -> String {
    json!({"status": "success", "value": {"etag": etag}}).to_string()
}

fn in_an_hour() -> i64 {
    chrono::Utc::now().timestamp_millis() + 3_600_000
}

fn pass_answer(pass: &str, rotates_at: i64) -> String {
    json!({"status": "success", "value": {"pass": pass, "rotatesAt": rotates_at as f64}})
        .to_string()
}

async fn schedule(base_url: &str, access: &Access) -> Value {
    query_from(
        base_url,
        access,
        queries::MEET_SCHEDULE,
        &json!({"meet": "Test Meet"}),
    )
    .await
    .unwrap()
}

async fn records(base_url: &str, access: &Access) -> Value {
    query_from(base_url, access, queries::RECORDS, &json!({}))
        .await
        .unwrap()
}

#[tokio::test]
async fn a_kept_answer_is_revalidated_instead_of_downloaded_again() {
    let dir = scratch("revalidated");
    let (base_url, requests) = serve(vec![
        reply(OK, None, tagged("\"e1\"", r#"[{"session":1}]"#)),
        reply(OK, None, unchanged("\"e1\"")),
        reply(OK, None, tagged("\"e2\"", r#"[{"session":2}]"#)),
        reply(OK, None, unchanged("\"e2\"")),
    ]);
    let run = || Access::anonymous().with_cache(Cache::at(dir.clone()));

    assert_eq!(schedule(&base_url, &run()).await, json!([{"session": 1}]));
    assert_eq!(schedule(&base_url, &run()).await, json!([{"session": 1}]));
    assert_eq!(schedule(&base_url, &run()).await, json!([{"session": 2}]));
    assert_eq!(schedule(&base_url, &run()).await, json!([{"session": 2}]));

    let sent: Vec<Value> = request_bodies(&requests)
        .into_iter()
        .map(|body| body["args"].clone())
        .collect();
    assert_eq!(
        sent,
        [
            json!({"meet": "Test Meet"}),
            json!({"meet": "Test Meet", "ifNoneMatch": "\"e1\""}),
            json!({"meet": "Test Meet", "ifNoneMatch": "\"e1\""}),
            json!({"meet": "Test Meet", "ifNoneMatch": "\"e2\""}),
        ]
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn a_corrupt_kept_answer_is_downloaded_again() {
    let dir = scratch("corrupt");
    let (base_url, requests) = serve(vec![
        reply(OK, None, tagged("\"e1\"", "[1]")),
        reply(OK, None, tagged("\"e1\"", "[1]")),
    ]);
    let run = || Access::anonymous().with_cache(Cache::at(dir.clone()));
    assert_eq!(schedule(&base_url, &run()).await, json!([1]));
    for entry in std::fs::read_dir(dir.join("answers").join("public")).unwrap() {
        std::fs::write(entry.unwrap().path(), "{\"etag\": \"\\\"e1\\\"\", \"js").unwrap();
    }

    assert_eq!(schedule(&base_url, &run()).await, json!([1]));

    assert_eq!(
        request_bodies(&requests)[1]["args"],
        json!({"meet": "Test Meet"})
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn the_pass_is_kept_until_it_rotates_with_the_premium_answers_read_with_it() {
    let dir = scratch("pass");
    let (base_url, requests) = serve(vec![
        reply(OK, None, pass_answer("p1", in_an_hour())),
        reply(OK, None, tagged("\"e1\"", "[1]")),
        reply(OK, None, unchanged("\"e1\"")),
    ]);
    let login = saved_login(&dir, &base_url);
    let run = || Access::from_file(login.clone()).with_cache(Cache::at(dir.join("cache")));

    assert_eq!(records(&base_url, &run()).await, json!([1]));
    assert_eq!(records(&base_url, &run()).await, json!([1]));

    let bodies = request_bodies(&requests);
    assert_eq!(bodies.len(), 3, "the second run fetched the pass again");
    assert_eq!(bodies[0]["path"], "accessPass:pass");
    assert_eq!(bodies[1]["args"], json!({"pass": "p1"}));
    assert_eq!(
        bodies[2]["args"],
        json!({"pass": "p1", "ifNoneMatch": "\"e1\""})
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn a_rotated_pass_drops_the_premium_answers_read_with_the_old_one() {
    let dir = scratch("rotated");
    let (base_url, requests) = serve(vec![
        reply(OK, None, pass_answer("p1", 1_000)),
        reply(OK, None, tagged("\"e1\"", "[1]")),
        reply(OK, None, pass_answer("p2", in_an_hour())),
        reply(OK, None, tagged("\"e1\"", "[1]")),
    ]);
    let login = saved_login(&dir, &base_url);
    let run = || Access::from_file(login.clone()).with_cache(Cache::at(dir.join("cache")));

    records(&base_url, &run()).await;
    records(&base_url, &run()).await;

    let bodies = request_bodies(&requests);
    assert_eq!(bodies[2]["path"], "accessPass:pass");
    assert_eq!(bodies[3]["args"], json!({"pass": "p2"}));
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn a_premium_answer_read_without_a_pass_is_not_kept() {
    let dir = scratch("passless");
    let (base_url, requests) = serve(vec![
        reply(OK, None, tagged("\"e1\"", "[1]")),
        reply(OK, None, tagged("\"e1\"", "[1]")),
    ]);
    let run = || Access::anonymous().with_cache(Cache::at(dir.clone()));

    records(&base_url, &run()).await;
    records(&base_url, &run()).await;

    assert_eq!(request_bodies(&requests)[1]["args"], json!({}));
    assert!(!dir.join("answers").join("premium").exists());
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn logging_out_drops_the_pass_and_the_premium_answers_but_not_the_public_ones() {
    let dir = scratch("logout");
    let (base_url, _requests) = serve(vec![
        reply(OK, None, pass_answer("p1", in_an_hour())),
        reply(OK, None, tagged("\"e1\"", "[1]")),
        reply(OK, None, tagged("\"e2\"", "[2]")),
    ]);
    let login = saved_login(&dir, &base_url);
    let cache = Cache::at(dir.join("cache"));
    let access = Access::from_file(login.clone()).with_cache(cache.clone());
    records(&base_url, &access).await;
    schedule(&base_url, &access).await;
    let premium = dir.join("cache").join("answers").join("premium");
    let pass = dir.join("cache").join("pass.json");
    assert!(premium.exists() && pass.exists());

    let expired = Credentials {
        token: "jwt-1".to_string(),
        token_id: "tid-1".to_string(),
        expires_at: 1,
        deployment: base_url.clone(),
    };
    credentials::save(&login, &expired).unwrap();
    logout(&login, Some(&cache), &mut Vec::new()).await.unwrap();

    assert!(!premium.exists());
    assert!(!pass.exists());
    assert!(dir.join("cache").join("answers").join("public").exists());
    std::fs::remove_dir_all(dir).unwrap();
}
