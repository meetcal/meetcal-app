//! A local HTTP server that answers each request with the next scripted Convex answer, shared by
//! the integration tests that call the real HTTP client; nothing here calls the live API.
#![allow(dead_code)]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::Value;

pub const RATE_LIMITED: &str = "429 Too Many Requests";
pub const UNAVAILABLE: &str = "503 Service Unavailable";
pub const OK: &str = "200 OK";
pub const NOT_FOUND: &str = "404 Not Found";
pub const FUNCTION_FAILED: &str = "560 Function Failed";

pub struct Reply {
    pub status: &'static str,
    pub retry_after: Option<&'static str>,
    pub body: String,
}

pub fn reply(
    status: &'static str,
    retry_after: Option<&'static str>,
    body: impl Into<String>,
) -> Reply {
    Reply {
        status,
        retry_after,
        body: body.into(),
    }
}

/// A server that answers each Convex call (a `POST /api/…`) with the next scripted reply, then
/// with 500s. Returns its base URL and the Convex calls (head and body) it has received.
///
/// Anything else that connects is answered 404 and neither recorded nor given a scripted reply:
/// tools on a developer's machine probe new local ports (`GET /`, or a connection that sends
/// nothing), and counting those made the tests fail at random.
pub fn serve(replies: Vec<Reply>) -> (String, Arc<Mutex<Vec<String>>>) {
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

            let reply = if is_convex_call(&head) {
                seen.lock().unwrap().push(head);
                replies.next().unwrap_or(reply(
                    "500 Internal Server Error",
                    None,
                    r#"{"error":"unexpected request"}"#,
                ))
            } else {
                reply(NOT_FOUND, None, r#"{"error":"not a Convex call"}"#)
            };
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

/// Whether a request is one the CLI makes: a `POST` to Convex's HTTP API.
fn is_convex_call(head: &str) -> bool {
    head.starts_with("POST /api/")
}

/// The JSON body of each request the test server received.
pub fn request_bodies(requests: &Mutex<Vec<String>>) -> Vec<Value> {
    requests
        .lock()
        .unwrap()
        .iter()
        .map(|request| {
            serde_json::from_str(&request[request.find("\r\n\r\n").unwrap() + 4..]).unwrap()
        })
        .collect()
}

/// The request line's path (`/api/query`) of each request the test server received.
pub fn request_paths(requests: &Mutex<Vec<String>>) -> Vec<String> {
    requests
        .lock()
        .unwrap()
        .iter()
        .map(|request| request.split(' ').nth(1).unwrap_or_default().to_string())
        .collect()
}

/// The `Authorization` header of each request the test server received, if it had one.
pub fn authorizations(requests: &Mutex<Vec<String>>) -> Vec<Option<String>> {
    requests
        .lock()
        .unwrap()
        .iter()
        .map(|request| {
            request[..request.find("\r\n\r\n").unwrap()]
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("authorization")
                        .then(|| value.trim().to_string())
                })
        })
        .collect()
}
