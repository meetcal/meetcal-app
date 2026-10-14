//! Exercises the retry policy, and paging, against a local HTTP server; nothing here calls the
//! live API.

mod support;

use meetcal::utils::access::Access;
use meetcal::utils::backend::{
    Endpoint, USER_AGENT, call_function, queries, query_all_pages_from, query_from,
};
use serde_json::{Value, json};
use support::{
    FUNCTION_FAILED, NOT_FOUND, OK, RATE_LIMITED, UNAVAILABLE, reply, request_bodies, serve,
};

async fn fetch(base_url: &str) -> anyhow::Result<Value> {
    query_from(
        base_url,
        &Access::anonymous(),
        queries::CLUB_ATHLETES,
        &json!({ "club": "Test Barbell" }),
    )
    .await
}

#[tokio::test]
async fn succeeds_after_a_429() {
    let (base_url, requests) = serve(vec![
        reply(RATE_LIMITED, Some("1"), r#"{"error":"rate limited"}"#),
        reply(
            OK,
            None,
            r#"{"status":"success","value":[{"meet":"Test Meet"}],"logLines":[]}"#,
        ),
    ]);

    let body = fetch(&base_url).await.expect("request should succeed");

    assert_eq!(body, json!([{ "meet": "Test Meet" }]));
    let requests = requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    for request in requests.iter() {
        assert!(request.starts_with("POST /api/query HTTP/1.1"));
        assert!(request.to_ascii_lowercase().contains(&format!(
            "user-agent: {}\r\n",
            USER_AGENT.to_ascii_lowercase()
        )));
        let body: Value = serde_json::from_str(&request[request.find("\r\n\r\n").unwrap() + 4..])
            .expect("the request body is JSON");
        assert_eq!(
            body,
            json!({"path": "reference:clubAthletes", "args": {"club": "Test Barbell"}, "format": "json"})
        );
    }
}

#[tokio::test]
async fn backs_off_on_503_without_retry_after() {
    let (base_url, requests) = serve(vec![
        reply(UNAVAILABLE, None, ""),
        reply(OK, None, r#"{"status":"success","value":[]}"#),
    ]);

    let body = fetch(&base_url).await.expect("request should succeed");

    assert_eq!(body, json!([]));
    assert_eq!(requests.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn gives_up_after_the_retry_limit() {
    let (base_url, requests) = serve(vec![
        reply(RATE_LIMITED, Some("1"), r#"{"error":"rate limited"}"#),
        reply(RATE_LIMITED, Some("0"), r#"{"error":"rate limited"}"#),
        reply(RATE_LIMITED, Some("7"), r#"{"error":"rate limited"}"#),
        reply(OK, None, r#"{"status":"success","value":[]}"#),
    ]);

    let error = fetch(&base_url).await.expect_err("request should fail");

    assert_eq!(
        error.to_string(),
        "The MeetCal API is rate limiting requests right now; try again in 7 seconds"
    );
    assert!(format!("{error:#}").contains("reference:clubAthletes returned 429 Too Many Requests"));
    assert_eq!(requests.lock().unwrap().len(), 3);
}

#[tokio::test]
async fn does_not_retry_a_404() {
    let (base_url, requests) = serve(vec![
        reply(NOT_FOUND, Some("1"), r#"{"error":"not found"}"#),
        reply(OK, None, r#"{"status":"success","value":[]}"#),
    ]);

    let error = fetch(&base_url).await.expect_err("request should fail");

    assert_eq!(
        error.to_string(),
        "MeetCal query reference:clubAthletes returned an error"
    );
    assert_eq!(requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn explains_a_query_that_failed_without_retrying() {
    let (base_url, requests) = serve(vec![
        reply(
            FUNCTION_FAILED,
            None,
            r#"{"status":"error","errorMessage":"Server Error","errorData":{"status":400,"error":"club must not be empty"}}"#,
        ),
        reply(OK, None, r#"{"status":"success","value":[]}"#),
    ]);

    let error = fetch(&base_url).await.expect_err("request should fail");

    assert_eq!(
        error.to_string(),
        "MeetCal could not answer reference:clubAthletes: club must not be empty"
    );
    assert_eq!(requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn pages_through_a_paged_query_with_its_cursor() {
    let (base_url, requests) = serve(vec![
        reply(
            OK,
            None,
            r#"{"status":"success","value":{"json":"[{\"meet\":\"Meet B\"}]","cursor":"c1","isDone":false}}"#,
        ),
        reply(RATE_LIMITED, Some("1"), r#"{"error":"rate limited"}"#),
        reply(
            OK,
            None,
            r#"{"status":"success","value":{"json":"[{\"meet\":\"Meet A\"}]","cursor":"c2","isDone":true}}"#,
        ),
    ]);

    let rows: Vec<Value> = query_all_pages_from(
        &base_url,
        &Access::anonymous(),
        queries::CLUB_ATHLETES,
        &json!({ "club": "Test Barbell" }),
    )
    .await
    .expect("paging should succeed");

    assert_eq!(rows, [json!({"meet": "Meet B"}), json!({"meet": "Meet A"})]);
    // The throttled second page is retried with the same cursor.
    assert_eq!(
        request_bodies(&requests)
            .iter()
            .map(|body| body["args"].clone())
            .collect::<Vec<_>>(),
        [
            json!({"club": "Test Barbell", "cursor": null}),
            json!({"club": "Test Barbell", "cursor": "c1"}),
            json!({"club": "Test Barbell", "cursor": "c1"}),
        ]
    );
}

#[tokio::test]
async fn actions_and_mutations_are_sent_once() {
    for (endpoint, function) in [
        (Endpoint::Action, "deviceLogin:poll"),
        (Endpoint::Mutation, "apiTokens:revoke"),
    ] {
        for (status, retry_after) in [(RATE_LIMITED, Some("1")), (UNAVAILABLE, None)] {
            let (base_url, requests) = serve(vec![
                reply(status, retry_after, r#"{"error":"busy"}"#),
                reply(OK, None, r#"{"status":"success","value":null}"#),
            ]);

            let answer =
                call_function::<Value>(&base_url, endpoint, function, &json!({}), None).await;

            assert!(answer.is_err(), "{function} {status}");
            assert_eq!(
                requests.lock().unwrap().len(),
                1,
                "{function} {status} was sent again"
            );
        }
    }
}
