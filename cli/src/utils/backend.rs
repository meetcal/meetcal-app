//! HTTP access to the MeetCal backend.
//!
//! Every request goes through [`send_with_retry`], which uses one shared client and applies the
//! policy in `utils::retry`.

use std::sync::OnceLock;
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use reqwest::{Client, Request, Response, StatusCode, header::RETRY_AFTER};
use serde::{Serialize, de::DeserializeOwned};

use crate::utils::retry::{next_retry_delay, parse_retry_after_secs};

/// Base URL of the MeetCal backend.
pub const API_BASE_URL: &str = "https://api.meetcal.app";

/// User-Agent sent with every request.
pub const USER_AGENT: &str = concat!("meetcal-cli/", env!("CARGO_PKG_VERSION"));

/// Time allowed to establish a connection.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Time allowed for a whole request, from connecting to reading the body.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

static CLIENT: OnceLock<Client> = OnceLock::new();

/// The HTTP client shared by every request.
pub fn client() -> Result<&'static Client> {
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }

    let client = Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .context("Failed to build the HTTP client")?;
    Ok(CLIENT.get_or_init(|| client))
}

/// GET `path` on the MeetCal backend and parse the JSON body.
///
/// path: /route
pub async fn get_json<T, Q>(path: &str, query: &Q) -> Result<T>
where
    T: DeserializeOwned,
    Q: Serialize + ?Sized,
{
    get_json_from(API_BASE_URL, path, query).await
}

/// GET `path` on the server at `base_url` and parse the JSON body.
pub async fn get_json_from<T, Q>(base_url: &str, path: &str, query: &Q) -> Result<T>
where
    T: DeserializeOwned,
    Q: Serialize + ?Sized,
{
    let request = client()?
        .get(format!("{base_url}{path}"))
        .query(query)
        .build()
        .with_context(|| format!("Failed to build request for MeetCal backend route {path}"))?;

    send_with_retry(request, path)
        .await?
        .json()
        .await
        .with_context(|| format!("Failed to parse MeetCal backend response from {path}"))
}

/// Sends `request`, retrying rate limited (429) and overloaded (503) responses as the retry
/// policy allows. Returns the response once it succeeds, or an error once it cannot.
pub async fn send_with_retry(request: Request, path: &str) -> Result<Response> {
    let mut retries_done = 0;

    loop {
        let attempt = request.try_clone().with_context(|| {
            format!("Failed to prepare request for MeetCal backend route {path}")
        })?;
        let response = client()?
            .execute(attempt)
            .await
            .with_context(|| format!("Failed to call MeetCal backend route {path}"))?;

        let status = response.status();
        let retry_after = response
            .headers()
            .get(RETRY_AFTER)
            .and_then(|value| value.to_str().ok());

        if let Some(delay) = next_retry_delay(status, retry_after, retries_done) {
            tokio::time::sleep(delay).await;
            retries_done += 1;
            continue;
        }

        if status == StatusCode::TOO_MANY_REQUESTS {
            let retry_after_secs = retry_after.and_then(parse_retry_after_secs);
            return Err(anyhow!(
                "MeetCal backend route {path} returned {status} after {retries_done} retries"
            )
            .context(rate_limited_message(retry_after_secs)));
        }

        return response
            .error_for_status()
            .with_context(|| format!("MeetCal backend route {path} returned an error"));
    }
}

/// The message shown when the API is still rate limiting after every retry.
pub fn rate_limited_message(retry_after_secs: Option<u64>) -> String {
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

    #[test]
    fn user_agent_names_the_cli_and_version() {
        assert_eq!(
            USER_AGENT,
            format!("meetcal-cli/{}", env!("CARGO_PKG_VERSION"))
        );
    }

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
}
