//! A reader that stops early (`meetcal clubs | head -1`) must end the run quietly, not with a
//! panic. Runs the binary against a local HTTP server; nothing here calls the live API.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::process::{Command, Stdio};
use std::thread;

/// A server answering every query with `clubs` club names, as `reference:clubs` does.
fn serve(clubs: usize) -> String {
    let names: Vec<String> = (0..clubs)
        .map(|n| format!("Test Barbell Club Number {n}"))
        .collect();
    let json = serde_json::to_string(&names).unwrap();
    let body = serde_json::json!({ "status": "success", "value": { "json": json } }).to_string();

    let listener = TcpListener::bind("127.0.0.1:0").expect("bind local test server");
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
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
            }
            let mut request = vec![0; content_length];
            let _ = reader.read_exact(&mut request);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
        }
    });
    base_url
}

#[test]
fn a_reader_closing_the_pipe_ends_the_run_quietly() {
    // Far more than a pipe holds, so the binary is still writing when the reader leaves.
    let base_url = serve(20_000);
    let mut child = Command::new(env!("CARGO_BIN_EXE_meetcal"))
        .args(["clubs", "--format", "csv"])
        .env("MEETCAL_CONVEX_URL", &base_url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("run meetcal");

    let mut first = String::new();
    BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut first)
        .expect("read the first line");
    // The reader (and with it the pipe) is dropped here.
    assert_eq!(first, "club\n");

    let status = child.wait().expect("wait for meetcal");
    let mut stderr = String::new();
    child
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut stderr)
        .unwrap();
    assert!(!stderr.contains("panicked"), "stderr: {stderr}");
    assert_eq!(status.code(), Some(0), "stderr: {stderr}");
}
