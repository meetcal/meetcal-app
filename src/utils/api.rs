use anyhow::{Context, Error, Result, anyhow};
use reqwest::{StatusCode, Url, header::RETRY_AFTER};
use serde::{Serialize, de::DeserializeOwned};
use std::time::Duration;

const DEFAULT_API_BASE_URL: &str = "https://api.meetcal.app";

/// Page origins the API's CORS policy accepts in production. Browsers on these
/// origins call the API directly so each visitor is rate limited by their own
/// IP address instead of sharing the Vercel proxy's.
const DIRECT_API_ORIGINS: &[&str] = &["https://meetcal.app", "https://www.meetcal.app"];

/// Retries allowed after the first attempt for a throttled or overloaded response.
pub(crate) const MAX_RETRIES: u32 = 2;
/// Wait used when a retryable response has no usable `Retry-After` value.
const DEFAULT_RETRY_DELAY_SECS: u64 = 1;
/// Bounds applied to `Retry-After` so an interactive page never stalls for long.
const MIN_RETRY_DELAY_SECS: u64 = 1;
const MAX_RETRY_DELAY_SECS: u64 = 10;

pub(crate) const RATE_LIMITED_MESSAGE: &str =
    "Too many requests right now; please try again in a moment";
pub(crate) const OVERLOADED_MESSAGE: &str =
    "MeetCal is busy right now; please try again in a moment";

/// Chooses the API base URL for a page served from `origin`.
///
/// Production origins call the API directly. Other origins on a Vercel build,
/// such as preview deployments that the API's CORS policy rejects, go through
/// the same-origin `/api` rewrite in `vercel.json`. Everything else, including
/// local development, calls the API directly.
pub(crate) fn api_base_url_for(origin: Option<&str>, vercel_build: bool) -> String {
    match origin {
        Some(origin) if DIRECT_API_ORIGINS.contains(&origin) => DEFAULT_API_BASE_URL.to_owned(),
        Some(origin) if vercel_build => format!("{origin}/api"),
        _ => DEFAULT_API_BASE_URL.to_owned(),
    }
}

fn api_base_url() -> String {
    let origin = web_sys::window().and_then(|window| window.location().origin().ok());
    api_base_url_for(origin.as_deref(), option_env!("VERCEL").is_some())
}

/// Whether a response status means the request may succeed if repeated later.
pub(crate) fn is_retryable_status(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::TOO_MANY_REQUESTS | StatusCode::SERVICE_UNAVAILABLE
    )
}

/// Whether to retry a response with `status` after `retries_so_far` retries.
pub(crate) fn should_retry(status: StatusCode, retries_so_far: u32) -> bool {
    is_retryable_status(status) && retries_so_far < MAX_RETRIES
}

/// How long to wait before retrying, from a `Retry-After` header value.
///
/// Whole seconds are clamped to 1..=10; a missing or unparseable value
/// (including the HTTP-date form) falls back to one second.
pub(crate) fn retry_delay(retry_after: Option<&str>) -> Duration {
    let seconds = retry_after
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(DEFAULT_RETRY_DELAY_SECS)
        .clamp(MIN_RETRY_DELAY_SECS, MAX_RETRY_DELAY_SECS);
    Duration::from_secs(seconds)
}

fn exhausted_retries_message(status: StatusCode) -> &'static str {
    if status == StatusCode::TOO_MANY_REQUESTS {
        RATE_LIMITED_MESSAGE
    } else {
        OVERLOADED_MESSAGE
    }
}

async fn sleep(duration: Duration) {
    let millis = i32::try_from(duration.as_millis()).unwrap_or(i32::MAX);
    let promise = js_sys::Promise::new(&mut |resolve, _reject| {
        let scheduled = web_sys::window().is_some_and(|window| {
            window
                .set_timeout_with_callback_and_timeout_and_arguments_0(&resolve, millis)
                .is_ok()
        });
        if !scheduled {
            let _ = resolve.call0(&wasm_bindgen::JsValue::UNDEFINED);
        }
    });
    let _ = wasm_bindgen_futures::JsFuture::from(promise).await;
}

/// Sends a GET request for `path`, retrying throttled (429) and overloaded (503)
/// responses. Every API call goes through here; all of them are reads, so
/// repeating one is safe.
async fn get_with_retry<Q>(path: &str, query: Option<&Q>) -> Result<reqwest::Response, Error>
where
    Q: Serialize + ?Sized,
{
    let client = reqwest::Client::new();
    let mut url = Url::parse(&format!("{}{path}", api_base_url()))
        .with_context(|| format!("Invalid MeetCal backend route {path}"))?;
    if let Some(query) = query {
        let request = client
            .get(url)
            .query(query)
            .build()
            .with_context(|| format!("Failed to build MeetCal backend request for {path}"))?;
        url = request.url().clone();
    }

    let mut retries = 0;
    loop {
        let response = client
            .get(url.clone())
            .send()
            .await
            .with_context(|| format!("Failed to call MeetCal backend route {path}"))?;
        let status = response.status();

        if should_retry(status, retries) {
            let retry_after = response
                .headers()
                .get(RETRY_AFTER)
                .and_then(|value| value.to_str().ok());
            sleep(retry_delay(retry_after)).await;
            retries += 1;
            continue;
        }
        if is_retryable_status(status) {
            return Err(anyhow!(exhausted_retries_message(status)));
        }

        return response
            .error_for_status()
            .with_context(|| format!("MeetCal backend route {path} returned an error"));
    }
}

/// path: /route
pub async fn get_api_response<T>(path: &str) -> Result<Vec<T>, Error>
where
    T: DeserializeOwned,
{
    get_with_retry::<()>(path, None)
        .await?
        .json::<Vec<T>>()
        .await
        .with_context(|| format!("Failed to parse MeetCal backend response from {path}"))
}

/// path: /route
/// query: array of tuples
pub async fn get_api_response_with_query<T, Q>(path: &str, query: &Q) -> Result<T, Error>
where
    T: DeserializeOwned,
    Q: Serialize + ?Sized,
{
    get_with_retry(path, Some(query))
        .await?
        .json::<T>()
        .await
        .with_context(|| format!("Failed to parse MeetCal backend response from {path}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_origins_call_the_api_directly() {
        for origin in ["https://meetcal.app", "https://www.meetcal.app"] {
            assert_eq!(api_base_url_for(Some(origin), true), DEFAULT_API_BASE_URL);
            assert_eq!(api_base_url_for(Some(origin), false), DEFAULT_API_BASE_URL);
        }
    }

    #[test]
    fn other_origins_on_vercel_builds_use_the_same_origin_rewrite() {
        assert_eq!(
            api_base_url_for(Some("https://meetcal-web-git-branch.vercel.app"), true),
            "https://meetcal-web-git-branch.vercel.app/api"
        );
        for lookalike in [
            "http://meetcal.app",
            "https://meetcal.app.example.com",
            "https://staging.meetcal.app",
        ] {
            assert_eq!(
                api_base_url_for(Some(lookalike), true),
                format!("{lookalike}/api")
            );
        }
    }

    #[test]
    fn non_vercel_builds_and_unknown_origins_call_the_api_directly() {
        assert_eq!(
            api_base_url_for(Some("http://localhost:3000"), false),
            DEFAULT_API_BASE_URL
        );
        assert_eq!(api_base_url_for(None, true), DEFAULT_API_BASE_URL);
        assert_eq!(api_base_url_for(None, false), DEFAULT_API_BASE_URL);
    }

    #[test]
    fn only_throttled_and_overloaded_responses_are_retryable() {
        assert!(is_retryable_status(StatusCode::TOO_MANY_REQUESTS));
        assert!(is_retryable_status(StatusCode::SERVICE_UNAVAILABLE));
        for status in [
            StatusCode::OK,
            StatusCode::NOT_FOUND,
            StatusCode::INTERNAL_SERVER_ERROR,
            StatusCode::BAD_GATEWAY,
            StatusCode::GATEWAY_TIMEOUT,
        ] {
            assert!(!is_retryable_status(status), "{status} must not retry");
        }
    }

    #[test]
    fn retries_stop_after_the_limit() {
        for status in [
            StatusCode::TOO_MANY_REQUESTS,
            StatusCode::SERVICE_UNAVAILABLE,
        ] {
            assert!(should_retry(status, 0));
            assert!(should_retry(status, 1));
            assert!(!should_retry(status, MAX_RETRIES));
            assert!(!should_retry(status, MAX_RETRIES + 1));
        }
        assert!(!should_retry(StatusCode::INTERNAL_SERVER_ERROR, 0));
        assert_eq!(MAX_RETRIES, 2);
    }

    #[test]
    fn retry_after_seconds_are_honoured_within_bounds() {
        assert_eq!(retry_delay(Some("3")), Duration::from_secs(3));
        assert_eq!(retry_delay(Some(" 7 ")), Duration::from_secs(7));
        assert_eq!(retry_delay(Some("1")), Duration::from_secs(1));
        assert_eq!(retry_delay(Some("10")), Duration::from_secs(10));
    }

    #[test]
    fn retry_after_is_clamped_to_one_through_ten_seconds() {
        assert_eq!(retry_delay(Some("0")), Duration::from_secs(1));
        assert_eq!(retry_delay(Some("11")), Duration::from_secs(10));
        assert_eq!(retry_delay(Some("3600")), Duration::from_secs(10));
        assert_eq!(
            retry_delay(Some("18446744073709551615")),
            Duration::from_secs(10)
        );
    }

    #[test]
    fn missing_or_invalid_retry_after_falls_back_to_one_second() {
        for value in [
            None,
            Some(""),
            Some("soon"),
            Some("-5"),
            Some("1.5"),
            Some("Wed, 21 Oct 2015 07:28:00 GMT"),
        ] {
            assert_eq!(retry_delay(value), Duration::from_secs(1), "{value:?}");
        }
    }

    #[test]
    fn exhausted_retries_explain_the_failure() {
        assert_eq!(
            exhausted_retries_message(StatusCode::TOO_MANY_REQUESTS),
            RATE_LIMITED_MESSAGE
        );
        assert_eq!(
            exhausted_retries_message(StatusCode::SERVICE_UNAVAILABLE),
            OVERLOADED_MESSAGE
        );
    }
}
