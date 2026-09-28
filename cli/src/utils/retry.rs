//! Retry policy for MeetCal API requests.
//!
//! Every request the CLI makes only reads data, so replaying one is safe. The policy is kept
//! free of I/O so it can be unit tested; `utils::backend` applies it to real requests.

use std::time::Duration;

use reqwest::StatusCode;

/// Number of times a request is retried after the first attempt before giving up.
pub const MAX_RETRIES: usize = 2;

/// Delays used when a retryable response carries no usable `Retry-After` header.
/// Entry `n` is the wait before retry `n + 1`.
pub const RETRY_BACKOFF: [Duration; MAX_RETRIES] = [Duration::from_secs(1), Duration::from_secs(2)];

/// Shortest wait honored from a `Retry-After` header, in seconds.
pub const MIN_RETRY_AFTER_SECS: u64 = 1;

/// Longest wait honored from a `Retry-After` header, in seconds.
pub const MAX_RETRY_AFTER_SECS: u64 = 30;

/// Whether a response status is worth retrying: rate limited (429) or overloaded (503).
pub fn is_retryable(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::TOO_MANY_REQUESTS | StatusCode::SERVICE_UNAVAILABLE
    )
}

/// Parses a `Retry-After` value given as whole seconds.
///
/// Returns `None` for anything that is not a non-negative integer, including the HTTP-date form,
/// which the MeetCal API does not send.
pub fn parse_retry_after_secs(value: &str) -> Option<u64> {
    value.trim().parse().ok()
}

/// The wait requested by a `Retry-After` header, clamped to
/// `MIN_RETRY_AFTER_SECS..=MAX_RETRY_AFTER_SECS`.
pub fn retry_after_delay(value: &str) -> Option<Duration> {
    parse_retry_after_secs(value)
        .map(|secs| Duration::from_secs(secs.clamp(MIN_RETRY_AFTER_SECS, MAX_RETRY_AFTER_SECS)))
}

/// Decides what to do after a failed attempt.
///
/// `retries_done` is how many retries have already been made for this request. Returns the time
/// to wait before retrying, or `None` when the request should not be retried.
pub fn next_retry_delay(
    status: StatusCode,
    retry_after: Option<&str>,
    retries_done: usize,
) -> Option<Duration> {
    if !is_retryable(status) {
        return None;
    }

    let backoff = *RETRY_BACKOFF.get(retries_done)?;
    Some(retry_after.and_then(retry_after_delay).unwrap_or(backoff))
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOO_MANY: StatusCode = StatusCode::TOO_MANY_REQUESTS;
    const UNAVAILABLE: StatusCode = StatusCode::SERVICE_UNAVAILABLE;

    #[test]
    fn parses_whole_seconds() {
        assert_eq!(parse_retry_after_secs("5"), Some(5));
        assert_eq!(parse_retry_after_secs(" 12 "), Some(12));
        assert_eq!(parse_retry_after_secs("0"), Some(0));
    }

    #[test]
    fn rejects_non_integer_retry_after() {
        assert_eq!(parse_retry_after_secs(""), None);
        assert_eq!(parse_retry_after_secs("-1"), None);
        assert_eq!(parse_retry_after_secs("1.5"), None);
        assert_eq!(parse_retry_after_secs("soon"), None);
        assert_eq!(
            parse_retry_after_secs("Wed, 21 Oct 2026 07:28:00 GMT"),
            None
        );
    }

    #[test]
    fn clamps_retry_after_to_allowed_range() {
        assert_eq!(retry_after_delay("0"), Some(Duration::from_secs(1)));
        assert_eq!(retry_after_delay("1"), Some(Duration::from_secs(1)));
        assert_eq!(retry_after_delay("7"), Some(Duration::from_secs(7)));
        assert_eq!(retry_after_delay("30"), Some(Duration::from_secs(30)));
        assert_eq!(retry_after_delay("31"), Some(Duration::from_secs(30)));
        assert_eq!(retry_after_delay("86400"), Some(Duration::from_secs(30)));
        assert_eq!(retry_after_delay("later"), None);
    }

    #[test]
    fn only_429_and_503_are_retryable() {
        assert!(is_retryable(TOO_MANY));
        assert!(is_retryable(UNAVAILABLE));
        for status in [
            StatusCode::OK,
            StatusCode::BAD_REQUEST,
            StatusCode::UNAUTHORIZED,
            StatusCode::FORBIDDEN,
            StatusCode::NOT_FOUND,
            StatusCode::INTERNAL_SERVER_ERROR,
            StatusCode::BAD_GATEWAY,
            StatusCode::GATEWAY_TIMEOUT,
        ] {
            assert!(!is_retryable(status), "{status} should not be retried");
        }
    }

    #[test]
    fn honors_retry_after_when_present() {
        assert_eq!(
            next_retry_delay(TOO_MANY, Some("4"), 0),
            Some(Duration::from_secs(4))
        );
        assert_eq!(
            next_retry_delay(UNAVAILABLE, Some("1"), 1),
            Some(Duration::from_secs(1))
        );
        assert_eq!(
            next_retry_delay(TOO_MANY, Some("600"), 0),
            Some(Duration::from_secs(MAX_RETRY_AFTER_SECS))
        );
    }

    #[test]
    fn backs_off_one_then_two_seconds_without_retry_after() {
        assert_eq!(
            next_retry_delay(TOO_MANY, None, 0),
            Some(Duration::from_secs(1))
        );
        assert_eq!(
            next_retry_delay(TOO_MANY, None, 1),
            Some(Duration::from_secs(2))
        );
        assert_eq!(
            next_retry_delay(UNAVAILABLE, Some("not-a-number"), 1),
            Some(Duration::from_secs(2))
        );
    }

    #[test]
    fn stops_after_max_retries() {
        assert_eq!(next_retry_delay(TOO_MANY, Some("1"), MAX_RETRIES), None);
        assert_eq!(next_retry_delay(UNAVAILABLE, None, MAX_RETRIES), None);
        assert_eq!(next_retry_delay(TOO_MANY, None, MAX_RETRIES + 1), None);
    }

    #[test]
    fn does_not_retry_other_errors() {
        assert_eq!(next_retry_delay(StatusCode::NOT_FOUND, Some("1"), 0), None);
        assert_eq!(next_retry_delay(StatusCode::BAD_REQUEST, None, 0), None);
        assert_eq!(
            next_retry_delay(StatusCode::INTERNAL_SERVER_ERROR, None, 0),
            None
        );
    }
}
