use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

pub(crate) const OK: &str = "200 OK";
pub(crate) const NOT_FOUND: &str = "404 Not Found";
pub(crate) const DROPPED: &str = "dropped";

pub(crate) struct Reply {
    pub(crate) status: &'static str,
    pub(crate) retry_after: Option<&'static str>,
    pub(crate) encoding: Option<&'static str>,
    pub(crate) body: Vec<u8>,
    pub(crate) cut_after: Option<usize>,
}

pub(crate) fn reply(
    status: &'static str,
    retry_after: Option<&'static str>,
    body: impl Into<String>,
) -> Reply {
    Reply {
        status,
        retry_after,
        encoding: None,
        body: body.into().into_bytes(),
        cut_after: None,
    }
}

pub(crate) fn serve(replies: Vec<Reply>) -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind local test server");
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    let requests = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&requests);

    thread::spawn(move || {
        let mut replies = replies.into_iter();
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
            let _ = stream.set_read_timeout(Some(PROBE_READ_TIMEOUT));

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

            let reply = if !is_probe(&head) {
                seen.lock().unwrap().push(head);
                replies.next().unwrap_or(reply(
                    "500 Internal Server Error",
                    None,
                    r#"{"error":"unexpected request"}"#,
                ))
            } else {
                reply(NOT_FOUND, None, r#"{"error":"not a test request"}"#)
            };
            if reply.status == DROPPED {
                continue;
            }
            let retry_after = reply
                .retry_after
                .map(|secs| format!("Retry-After: {secs}\r\n"))
                .unwrap_or_default();
            let encoding = reply
                .encoding
                .map(|encoding| format!("Content-Encoding: {encoding}\r\n"))
                .unwrap_or_default();
            let mut response = format!(
                "HTTP/1.1 {}\r\nContent-Type: application/json\r\n{retry_after}{encoding}Content-Length: {}\r\nConnection: close\r\n\r\n",
                reply.status,
                reply.body.len(),
            )
            .into_bytes();
            let body = match reply.cut_after {
                Some(bytes) => &reply.body[..bytes.min(reply.body.len())],
                None => &reply.body[..],
            };
            response.extend_from_slice(body);
            let _ = stream.write_all(&response);
        }
    });

    (base_url, requests)
}

const PROBE_READ_TIMEOUT: Duration = Duration::from_secs(5);

fn is_probe(head: &str) -> bool {
    let line = head.lines().next().unwrap_or_default();
    line.trim().is_empty() || line.starts_with("GET / ")
}
