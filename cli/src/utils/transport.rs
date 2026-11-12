use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use reqwest::{Client, Request, Response, StatusCode, header::RETRY_AFTER};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

use crate::utils::backend::USER_AGENT;
use crate::utils::retry::{
    Failure, next_failure_retry_delay, next_retry_delay, parse_retry_after_secs,
};

pub(crate) const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);

pub(crate) const ANSWER_TIMEOUT: Duration = Duration::from_secs(60);

pub(crate) const STALL_TIMEOUT: Duration = Duration::from_secs(20);

pub(crate) const REQUEST_CAP: Duration = Duration::from_secs(300);

pub(crate) const MAX_ANSWER_BYTES: usize = 64 * 1024 * 1024;

const FUNCTION_FAILED: u16 = 560;

static CLIENT: OnceLock<Client> = OnceLock::new();

pub(crate) fn client() -> Result<&'static Client> {
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }

    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_CAP)
        .build()
        .context("Failed to build the HTTP client")?;
    Ok(CLIENT.get_or_init(|| client))
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Sending {
    pub(crate) retries: bool,
    pub(crate) answer_within: Duration,
    pub(crate) stall_after: Duration,
}

impl Sending {
    pub(crate) const READ: Sending = Sending {
        retries: true,
        answer_within: ANSWER_TIMEOUT,
        stall_after: STALL_TIMEOUT,
    };

    pub(crate) const ONCE: Sending = Sending {
        retries: false,
        ..Sending::READ
    };
}

fn unreachable_origins() -> &'static Mutex<HashSet<String>> {
    static ORIGINS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    ORIGINS.get_or_init(Mutex::default)
}

fn is_unreachable(origin: &str) -> bool {
    unreachable_origins()
        .lock()
        .is_ok_and(|origins| origins.contains(origin))
}

fn mark_unreachable(origin: &str) {
    if let Ok(mut origins) = unreachable_origins().lock() {
        origins.insert(origin.to_string());
    }
}

type ConnectionGate = Arc<AsyncMutex<bool>>;

fn connection_gate(origin: &str) -> ConnectionGate {
    static GATES: OnceLock<Mutex<HashMap<String, ConnectionGate>>> = OnceLock::new();
    let mut gates = GATES
        .get_or_init(Mutex::default)
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    Arc::clone(gates.entry(origin.to_string()).or_default())
}

async fn first_on_connection(origin: &str) -> Option<OwnedMutexGuard<bool>> {
    let guard = connection_gate(origin).lock_owned().await;
    (!*guard).then_some(guard)
}

fn connected(first: Option<OwnedMutexGuard<bool>>) {
    if let Some(mut guard) = first {
        *guard = true;
    }
}

enum Attempt {
    Answered(Vec<u8>),
    Throttled(Duration),
    Failed(Failure, Option<reqwest::Error>),
}

pub(crate) async fn send(request: Request, function: &str, sending: Sending) -> Result<Vec<u8>> {
    let origin = request.url().origin().ascii_serialization();
    let mut retries_done = 0;
    loop {
        if is_unreachable(&origin) {
            return Err(anyhow!("MeetCal was unreachable earlier in this run")
                .context(Failure::Unreachable.message(function)));
        }
        let attempt = request
            .try_clone()
            .with_context(|| format!("Failed to prepare request for MeetCal query {function}"))?;
        let mut first = first_on_connection(&origin).await;
        let answered =
            tokio::time::timeout(sending.answer_within, client()?.execute(attempt)).await;
        let outcome = match answered {
            Err(_) => Attempt::Failed(Failure::NoAnswer, None),
            Ok(Err(error)) => Attempt::Failed(failure_of(&error), Some(error)),
            Ok(Ok(response)) => {
                connected(first.take());
                answer(response, function, sending, retries_done).await?
            }
        };
        drop(first);
        let delay = match outcome {
            Attempt::Answered(body) => return Ok(body),
            Attempt::Throttled(delay) => delay,
            Attempt::Failed(failure, error) => {
                match next_failure_retry_delay(failure, retries_done).filter(|_| sending.retries) {
                    Some(delay) => delay,
                    None => return Err(given_up(&origin, function, failure, error, sending)),
                }
            }
        };
        tokio::time::sleep(delay).await;
        retries_done += 1;
    }
}

fn given_up(
    origin: &str,
    function: &str,
    failure: Failure,
    error: Option<reqwest::Error>,
    sending: Sending,
) -> anyhow::Error {
    if failure == Failure::Unreachable {
        mark_unreachable(origin);
    }
    let cause = match error {
        Some(error) => anyhow::Error::new(error),
        None => match failure {
            Failure::NoAnswer => anyhow!("no answer within {:?}", sending.answer_within),
            Failure::Stalled => anyhow!("nothing arrived for {:?}", sending.stall_after),
            Failure::Unreachable | Failure::Dropped | Failure::Cut => {
                anyhow!("the connection closed early")
            }
        },
    };
    cause.context(failure.message(function))
}

fn failure_of(error: &reqwest::Error) -> Failure {
    if error.is_connect() {
        Failure::Unreachable
    } else if error.is_timeout() {
        Failure::NoAnswer
    } else {
        Failure::Dropped
    }
}

async fn answer(
    response: Response,
    function: &str,
    sending: Sending,
    retries_done: usize,
) -> Result<Attempt> {
    let status = response.status();
    let retry_after = response
        .headers()
        .get(RETRY_AFTER)
        .and_then(|value| value.to_str().ok());

    if let Some(delay) =
        next_retry_delay(status, retry_after, retries_done).filter(|_| sending.retries)
    {
        return Ok(Attempt::Throttled(delay));
    }

    if status == StatusCode::TOO_MANY_REQUESTS {
        let retry_after_secs = retry_after.and_then(parse_retry_after_secs);
        return Err(anyhow!(
            "MeetCal query {function} returned {status} after {retries_done} retries"
        )
        .context(rate_limited_message(retry_after_secs)));
    }

    let response = if status.as_u16() == FUNCTION_FAILED {
        response
    } else {
        response
            .error_for_status()
            .with_context(|| format!("MeetCal query {function} returned an error"))?
    };
    read_body(response, function, sending.stall_after).await
}

async fn read_body(
    mut response: Response,
    function: &str,
    stall_after: Duration,
) -> Result<Attempt> {
    let mut body = Vec::new();
    loop {
        let failed = |failure, error| Ok(Attempt::Failed(failure, error));
        match tokio::time::timeout(stall_after, response.chunk()).await {
            Err(_) => return failed(Failure::Stalled, None),
            Ok(Err(error)) if error.is_timeout() => return failed(Failure::Stalled, Some(error)),
            Ok(Err(error)) => return failed(Failure::Cut, Some(error)),
            Ok(Ok(None)) => return Ok(Attempt::Answered(body)),
            Ok(Ok(Some(chunk))) if body.len() + chunk.len() > MAX_ANSWER_BYTES => {
                return Err(anyhow!(
                    "MeetCal's answer to {function} is larger than {MAX_ANSWER_BYTES} bytes"
                ));
            }
            Ok(Ok(Some(chunk))) => body.extend_from_slice(&chunk),
        }
    }
}

pub(crate) fn rate_limited_message(retry_after_secs: Option<u64>) -> String {
    let wait = match retry_after_secs {
        Some(0 | 1) => "1 second".to_string(),
        Some(secs) => format!("{secs} seconds"),
        None => "a few seconds".to_string(),
    };
    format!("The MeetCal API is rate limiting requests right now; try again in {wait}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::time::Instant;

    #[test]
    fn client_is_built_once() {
        let first = client().unwrap();
        let second = client().unwrap();
        assert!(std::ptr::eq(first, second));
    }

    #[test]
    fn rate_limited_message_names_the_wait() {
        assert_eq!(
            rate_limited_message(Some(12)),
            "The MeetCal API is rate limiting requests right now; try again in 12 seconds"
        );
        assert_eq!(
            rate_limited_message(Some(1)),
            "The MeetCal API is rate limiting requests right now; try again in 1 second"
        );
        assert_eq!(
            rate_limited_message(None),
            "The MeetCal API is rate limiting requests right now; try again in a few seconds"
        );
    }

    enum Script {
        Stall,
        Whole,
        Silent,
    }

    const BODY: &str = r#"{"status":"success","value":[]}"#;

    fn serve(scripts: Vec<Script>) -> (String, Arc<Mutex<usize>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let served = Arc::new(Mutex::new(0));
        let count = Arc::clone(&served);
        std::thread::spawn(move || {
            let mut held = Vec::new();
            for (stream, script) in listener.incoming().zip(scripts) {
                let Ok(mut stream) = stream else { break };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut length = 0;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        length = value.trim().parse().unwrap_or(0);
                    }
                }
                let mut request_body = vec![0; length];
                let _ = std::io::Read::read_exact(&mut reader, &mut request_body);
                *count.lock().unwrap() += 1;
                let head = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    BODY.len()
                );
                match script {
                    Script::Stall => {
                        let _ = stream.write_all(head.as_bytes());
                        let _ = stream.write_all(&BODY.as_bytes()[..5]);
                        let _ = stream.flush();
                        held.push(stream);
                    }
                    Script::Whole => {
                        let _ = stream.write_all(head.as_bytes());
                        let _ = stream.write_all(BODY.as_bytes());
                    }
                    Script::Silent => held.push(stream),
                }
            }
            std::thread::sleep(Duration::from_secs(30));
            drop(held);
        });
        (base_url, served)
    }

    fn request(base_url: &str) -> Request {
        client()
            .unwrap()
            .post(format!("{base_url}/api/query"))
            .body("{}")
            .build()
            .unwrap()
    }

    const QUICK: Sending = Sending {
        retries: true,
        answer_within: Duration::from_millis(300),
        stall_after: Duration::from_millis(300),
    };

    #[tokio::test]
    async fn a_read_whose_answer_stalls_is_sent_again() {
        let (base_url, served) = serve(vec![Script::Stall, Script::Whole]);
        let body = send(request(&base_url), "test:stall", QUICK).await.unwrap();
        assert_eq!(body, BODY.as_bytes());
        assert_eq!(*served.lock().unwrap(), 2);
    }

    #[tokio::test]
    async fn an_answer_that_keeps_stalling_says_so() {
        let (base_url, served) = serve(vec![Script::Stall, Script::Stall, Script::Stall]);
        let error = send(request(&base_url), "test:stall", QUICK)
            .await
            .unwrap_err();
        assert_eq!(
            error.to_string(),
            "MeetCal's answer to test:stall stopped arriving. Check your internet connection and try again."
        );
        assert_eq!(*served.lock().unwrap(), 3);
    }

    #[tokio::test]
    async fn a_read_with_no_answer_is_not_sent_again() {
        let (base_url, served) = serve(vec![Script::Silent, Script::Whole]);
        let error = send(request(&base_url), "test:silent", QUICK)
            .await
            .unwrap_err();
        assert_eq!(
            error.to_string(),
            "MeetCal did not answer test:silent in time. Check your internet connection and try again."
        );
        assert_eq!(*served.lock().unwrap(), 1);
    }

    #[tokio::test]
    async fn an_unreachable_deployment_fails_every_later_read_at_once() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);

        let started = Instant::now();
        let error = send(request(&base_url), "test:first", Sending::READ)
            .await
            .unwrap_err();
        assert_eq!(
            error.to_string(),
            "Could not reach MeetCal. Check your internet connection and try again."
        );
        assert!(started.elapsed() >= Duration::from_secs(1));

        let started = Instant::now();
        let error = send(request(&base_url), "test:second", Sending::READ)
            .await
            .unwrap_err();
        assert_eq!(
            error.to_string(),
            "Could not reach MeetCal. Check your internet connection and try again."
        );
        assert!(started.elapsed() < Duration::from_millis(500));
    }

    #[tokio::test]
    async fn concurrent_first_reads_wait_for_the_first_answer() {
        let (base_url, served) = serve(vec![Script::Whole, Script::Whole, Script::Whole]);
        let origin = reqwest::Url::parse(&base_url)
            .unwrap()
            .origin()
            .ascii_serialization();
        let first = first_on_connection(&origin).await;
        assert!(first.is_some());
        let waiting = tokio::spawn({
            let base_url = base_url.clone();
            async move { send(request(&base_url), "test:second", QUICK).await }
        });
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(*served.lock().unwrap(), 0);
        connected(first);
        assert_eq!(waiting.await.unwrap().unwrap(), BODY.as_bytes());
        assert!(first_on_connection(&origin).await.is_none());
        send(request(&base_url), "test:third", QUICK).await.unwrap();
        assert_eq!(*served.lock().unwrap(), 2);
    }
}
