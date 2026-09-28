//! Exercises the retry policy against a local HTTP server; nothing here calls the live API.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread;

use meetcal::utils::backend::{USER_AGENT, get_json_from};
use serde_json::{Value, json};

const RATE_LIMITED: &str = "429 Too Many Requests";
const UNAVAILABLE: &str = "503 Service Unavailable";
const OK: &str = "200 OK";
const NOT_FOUND: &str = "404 Not Found";

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
/// Returns its base URL and the request heads it has received.
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
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                    break;
                }
                head.push_str(&line);
            }
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
    get_json_from(base_url, "/data/records", &[("gender", "Women")]).await
}

#[tokio::test]
async fn succeeds_after_a_429() {
    let (base_url, requests) = serve(vec![
        reply(RATE_LIMITED, Some("1"), r#"{"error":"rate limited"}"#),
        reply(OK, None, r#"[{"lift":"snatch"}]"#),
    ]);

    let body = fetch(&base_url).await.expect("request should succeed");

    assert_eq!(body, json!([{ "lift": "snatch" }]));
    let requests = requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    for head in requests.iter() {
        assert!(head.starts_with("GET /data/records?gender=Women HTTP/1.1"));
        let head = head.to_ascii_lowercase();
        assert!(head.contains(&format!("user-agent: {USER_AGENT}\r\n")));
    }
}

#[tokio::test]
async fn backs_off_on_503_without_retry_after() {
    let (base_url, requests) = serve(vec![reply(UNAVAILABLE, None, ""), reply(OK, None, "[]")]);

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
        reply(OK, None, "[]"),
    ]);

    let error = fetch(&base_url).await.expect_err("request should fail");

    assert_eq!(
        error.to_string(),
        "The MeetCal API is rate limiting requests right now; try again in 7 seconds"
    );
    assert!(format!("{error:#}").contains("/data/records returned 429 Too Many Requests"));
    assert_eq!(requests.lock().unwrap().len(), 3);
}

#[tokio::test]
async fn does_not_retry_a_404() {
    let (base_url, requests) = serve(vec![
        reply(NOT_FOUND, Some("1"), r#"{"error":"not found"}"#),
        reply(OK, None, "[]"),
    ]);

    let error = fetch(&base_url).await.expect_err("request should fail");

    assert_eq!(
        error.to_string(),
        "MeetCal backend route /data/records returned an error"
    );
    assert_eq!(requests.lock().unwrap().len(), 1);
}
