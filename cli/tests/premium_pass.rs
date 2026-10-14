//! Premium reads and the access pass, against a local HTTP server: a saved login is traded for
//! the pass once, the pass rides in premium reads' arguments, and a refused read renews it once
//! or tells the user to log in or subscribe. Nothing here calls the live API.

mod support;

use std::path::PathBuf;

use meetcal::utils::access::{Access, LOGIN_NEEDED};
use meetcal::utils::backend::{PassRefused, queries, query_from};
use meetcal::utils::credentials::{self, Credentials};
use serde_json::{Value, json};
use support::{FUNCTION_FAILED, OK, authorizations, reply, request_bodies, request_paths, serve};

const ROWS: &str = r#"{"status":"success","value":[{"meet":"Test Meet"}]}"#;

fn pass_answer(pass: &str) -> String {
    format!(r#"{{"status":"success","value":{{"pass":"{pass}","rotatesAt":4102444800000.0}}}}"#)
}

fn refreshed(active: bool) -> String {
    format!(r#"{{"status":"success","value":{{"active":{active}}}}}"#)
}

fn refused(status: u16, error: &str) -> String {
    format!(
        r#"{{"status":"error","errorMessage":"Server Error","errorData":{{"status":{status},"error":"{error}"}}}}"#
    )
}

/// A login saved in a fresh directory, issued by `deployment` and expiring at `expires_at`.
fn saved_login(test: &str, deployment: &str, expires_at: i64) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("meetcal-premium-{test}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let path = dir.join("credentials.json");
    credentials::save(
        &path,
        &Credentials {
            token: "jwt-1".to_string(),
            token_id: "tid-1".to_string(),
            expires_at,
            deployment: deployment.to_string(),
        },
    )
    .unwrap();
    path
}

const FAR_FUTURE: i64 = 4_102_444_800_000;

async fn read_club(base_url: &str, access: &Access) -> anyhow::Result<Value> {
    query_from(
        base_url,
        access,
        queries::CLUB_ATHLETES,
        &json!({ "club": "Test Barbell" }),
    )
    .await
}

#[tokio::test]
async fn a_logged_in_read_fetches_the_pass_once_and_carries_it() {
    let (base_url, requests) = serve(vec![
        reply(OK, None, pass_answer("p1")),
        reply(OK, None, ROWS),
        reply(OK, None, ROWS),
        reply(OK, None, r#"{"status":"success","value":{"json":"[]"}}"#),
    ]);
    let access = Access::from_file(saved_login("once", &base_url, FAR_FUTURE));

    read_club(&base_url, &access).await.unwrap();
    read_club(&base_url, &access).await.unwrap();
    // A public read carries neither the pass nor the token.
    let _: Value = query_from(
        &base_url,
        &access,
        queries::MEET_SCHEDULE,
        &json!({ "meet": "Test Meet" }),
    )
    .await
    .unwrap();

    let bodies = request_bodies(&requests);
    assert_eq!(bodies.len(), 4);
    assert_eq!(bodies[0]["path"], "accessPass:pass");
    assert_eq!(bodies[0]["args"], json!({}));
    for body in &bodies[1..3] {
        assert_eq!(body["args"], json!({"club": "Test Barbell", "pass": "p1"}));
    }
    assert_eq!(bodies[3]["args"], json!({"meet": "Test Meet"}));
    // Only the pass fetch carries the token.
    assert_eq!(
        authorizations(&requests),
        [Some("Bearer jwt-1".to_string()), None, None, None]
    );
    assert!(
        request_paths(&requests)
            .iter()
            .all(|path| path == "/api/query")
    );
}

#[tokio::test]
async fn a_refused_pass_is_renewed_and_the_read_tried_once_more() {
    let (base_url, requests) = serve(vec![
        reply(OK, None, pass_answer("old")),
        reply(FUNCTION_FAILED, None, refused(403, "access pass expired")),
        reply(OK, None, pass_answer("new")),
        reply(OK, None, ROWS),
    ]);
    let access = Access::from_file(saved_login("renew", &base_url, FAR_FUTURE));

    let rows = read_club(&base_url, &access).await.unwrap();

    assert_eq!(rows, json!([{"meet": "Test Meet"}]));
    let bodies = request_bodies(&requests);
    assert_eq!(
        bodies
            .iter()
            .map(|body| body["args"]["pass"].clone())
            .collect::<Vec<_>>(),
        [Value::Null, json!("old"), Value::Null, json!("new")]
    );
}

#[tokio::test]
async fn a_pass_refused_twice_fails_with_advice() {
    let (base_url, requests) = serve(vec![
        reply(OK, None, pass_answer("p1")),
        reply(FUNCTION_FAILED, None, refused(403, "access pass expired")),
        reply(OK, None, pass_answer("p2")),
        reply(FUNCTION_FAILED, None, refused(403, "access pass expired")),
    ]);
    let access = Access::from_file(saved_login("twice", &base_url, FAR_FUTURE));

    let error = read_club(&base_url, &access).await.unwrap_err();

    assert!(PassRefused::is(&error));
    assert!(
        error.to_string().contains("did not accept the access pass"),
        "{error}"
    );
    assert_eq!(requests.lock().unwrap().len(), 4);
}

#[tokio::test]
async fn without_a_login_a_read_goes_without_a_pass() {
    let (base_url, requests) = serve(vec![reply(OK, None, ROWS)]);

    read_club(&base_url, &Access::anonymous()).await.unwrap();

    let bodies = request_bodies(&requests);
    assert_eq!(bodies.len(), 1);
    assert_eq!(bodies[0]["args"], json!({"club": "Test Barbell"}));
}

#[tokio::test]
async fn a_refused_read_without_a_login_says_to_log_in() {
    let (base_url, requests) = serve(vec![reply(
        FUNCTION_FAILED,
        None,
        refused(401, "access pass required"),
    )]);

    let error = read_club(&base_url, &Access::anonymous())
        .await
        .unwrap_err();

    assert_eq!(error.to_string(), LOGIN_NEEDED);
    assert!(PassRefused::is(&error));
    assert_eq!(requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_refused_read_without_a_subscription_says_so() {
    let (base_url, requests) = serve(vec![
        reply(FUNCTION_FAILED, None, refused(403, "subscription required")),
        reply(OK, None, refreshed(false)),
        reply(FUNCTION_FAILED, None, refused(401, "access pass required")),
    ]);
    let access = Access::from_file(saved_login("unsubscribed", &base_url, FAR_FUTURE));

    let error = read_club(&base_url, &access).await.unwrap_err();

    assert!(
        error.to_string().contains("MeetCal subscription is needed"),
        "{error}"
    );
    let bodies = request_bodies(&requests);
    assert_eq!(bodies.len(), 3);
    assert_eq!(bodies[1]["path"], "entitlements:refresh");
    assert_eq!(bodies[2]["args"], json!({"club": "Test Barbell"}));
    assert_eq!(
        request_paths(&requests),
        ["/api/query", "/api/action", "/api/query"]
    );
}

#[tokio::test]
async fn a_subscription_convex_has_not_heard_of_is_refreshed_and_gets_the_pass() {
    let (base_url, requests) = serve(vec![
        reply(FUNCTION_FAILED, None, refused(403, "subscription required")),
        reply(OK, None, refreshed(true)),
        reply(OK, None, pass_answer("p1")),
        reply(OK, None, ROWS),
    ]);
    let access = Access::from_file(saved_login("refreshed", &base_url, FAR_FUTURE));

    read_club(&base_url, &access).await.unwrap();

    let bodies = request_bodies(&requests);
    assert_eq!(
        bodies
            .iter()
            .map(|body| body["path"].clone())
            .collect::<Vec<_>>(),
        [
            json!("accessPass:pass"),
            json!("entitlements:refresh"),
            json!("accessPass:pass"),
            json!("reference:clubAthletes"),
        ]
    );
    assert_eq!(
        bodies[3]["args"],
        json!({"club": "Test Barbell", "pass": "p1"})
    );
    assert_eq!(
        authorizations(&requests),
        [
            Some("Bearer jwt-1".to_string()),
            Some("Bearer jwt-1".to_string()),
            Some("Bearer jwt-1".to_string()),
            None
        ]
    );
}

#[tokio::test]
async fn a_failed_refresh_leaves_the_read_without_a_pass() {
    let (base_url, requests) = serve(vec![
        reply(FUNCTION_FAILED, None, refused(403, "subscription required")),
        reply(FUNCTION_FAILED, None, refused(429, "try again in a minute")),
        reply(OK, None, ROWS),
    ]);
    let access = Access::from_file(saved_login("refresh-failed", &base_url, FAR_FUTURE));

    read_club(&base_url, &access).await.unwrap();

    let bodies = request_bodies(&requests);
    assert_eq!(bodies.len(), 3);
    assert_eq!(bodies[2]["args"], json!({"club": "Test Barbell"}));
}

#[tokio::test]
async fn an_expired_or_foreign_login_is_not_sent() {
    for (test, deployment, expires_at) in [
        ("expired", None, 1_000),
        (
            "foreign",
            Some("https://elsewhere.convex.cloud"),
            FAR_FUTURE,
        ),
    ] {
        let (base_url, requests) = serve(vec![reply(OK, None, ROWS)]);
        let deployment = deployment.unwrap_or(&base_url);
        let access = Access::from_file(saved_login(test, deployment, expires_at));

        read_club(&base_url, &access).await.unwrap();

        let bodies = request_bodies(&requests);
        assert_eq!(bodies.len(), 1, "{test}");
        assert_eq!(bodies[0]["path"], "reference:clubAthletes", "{test}");
        assert_eq!(authorizations(&requests), [None], "{test}");
    }
}

#[tokio::test]
async fn only_a_dated_search_fetches_the_pass() {
    let (base_url, requests) = serve(vec![
        reply(OK, None, r#"{"status":"success","value":{"results":[]}}"#),
        reply(OK, None, pass_answer("p1")),
        reply(OK, None, r#"{"status":"success","value":{"results":[]}}"#),
    ]);
    let access = Access::from_file(saved_login("search", &base_url, FAR_FUTURE));

    let _: Value = query_from(
        &base_url,
        &access,
        queries::SEARCH,
        &json!({"query": "Smi"}),
    )
    .await
    .unwrap();
    let _: Value = query_from(
        &base_url,
        &access,
        queries::SEARCH,
        &json!({"query": "Smith", "startDate": "2026-01-01", "endDate": "2026-12-31"}),
    )
    .await
    .unwrap();

    let bodies = request_bodies(&requests);
    assert_eq!(bodies[0]["args"], json!({"query": "Smi"}));
    assert_eq!(bodies[1]["path"], "accessPass:pass");
    assert_eq!(bodies[2]["args"]["pass"], "p1");
}
