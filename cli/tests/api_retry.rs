//! Exercises the retry policy against a local HTTP server; nothing here calls the live API.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread;

use meetcal::utils::backend::{USER_AGENT, queries, query_from};
use serde_json::{Value, json};

const RATE_LIMITED: &str = "429 Too Many Requests";
const UNAVAILABLE: &str = "503 Service Unavailable";
const OK: &str = "200 OK";
const NOT_FOUND: &str = "404 Not Found";
const FUNCTION_FAILED: &str = "560 Function Failed";

struct Reply {
    status: &'static str,
    retry_after: Option<&'static str>,
    body: &'static str,
}

fn reply(status: &'static str, retry_after: Option<&'static str>, body: &'static str) -> Reply {
    Reply {
        status,
        retry_after,
        body,
    }
}

/// A server that answers each connection with the next scripted reply, then with 500s.
/// Returns its base URL and the requests (head and body) it has received.
fn serve(replies: Vec<Reply>) -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind local test server");
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    let requests = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&requests);

    thread::spawn(move || {
        let mut replies = replies.into_iter();
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };

            let mut head = String::new();
            let mut reader = BufReader::new(&stream);
            let mut content_length = 0;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                    break;
                }
                if let Some(length) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    content_length = length.trim().parse().unwrap_or(0);
                }
                head.push_str(&line);
            }
            let mut body = vec![0; content_length];
            let _ = reader.read_exact(&mut body);
            head.push_str("\r\n");
            head.push_str(&String::from_utf8_lossy(&body));
            seen.lock().unwrap().push(head);

            let reply = replies.next().unwrap_or(reply(
                "500 Internal Server Error",
                None,
                r#"{"error":"unexpected request"}"#,
            ));
            let retry_after = reply
                .retry_after
                .map(|secs| format!("Retry-After: {secs}\r\n"))
                .unwrap_or_default();
            let response = format!(
                "HTTP/1.1 {}\r\nContent-Type: application/json\r\n{retry_after}Content-Length: {}\r\nConnection: close\r\n\r\n{}",
                reply.status,
                reply.body.len(),
                reply.body,
            );
            let _ = stream.write_all(response.as_bytes());
        }
    });

    (base_url, requests)
}

async fn fetch(base_url: &str) -> anyhow::Result<Value> {
    query_from(
        base_url,
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
