use anyhow::{Result, anyhow};
use reqwest::{StatusCode, header::RETRY_AFTER};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

pub(super) const PRODUCTION_CONVEX_URL: &str = "https://disciplined-hare-790.convex.cloud";

pub(crate) const MAX_RETRIES: u32 = 2;
pub(super) const DEFAULT_RETRY_DELAY_SECS: u64 = 1;
pub(super) const MIN_RETRY_DELAY_SECS: u64 = 1;
pub(super) const MAX_RETRY_DELAY_SECS: u64 = 10;

pub(super) const FUNCTION_FAILED: u16 = 560;

pub(crate) const RATE_LIMITED_MESSAGE: &str =
    "Too many requests right now; please try again in a moment";
pub(crate) const OVERLOADED_MESSAGE: &str =
    "MeetCal is busy right now; please try again in a moment";

pub(crate) const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

pub(crate) const TIMED_OUT_MESSAGE: &str = "MeetCal took too long to answer; please try again";
pub(crate) const OFFLINE_MESSAGE: &str =
    "You appear to be offline; reconnect and it will load again";
pub(crate) const UNREACHABLE_MESSAGE: &str =
    "MeetCal couldn't be reached; check your connection and try again";
pub(crate) const UNREADABLE_MESSAGE: &str =
    "MeetCal sent an answer this page couldn't read; please try again";

pub(super) fn convex_url() -> &'static str {
    option_env!("MEETCAL_CONVEX_URL")
        .filter(|url| !url.is_empty())
        .unwrap_or(PRODUCTION_CONVEX_URL)
}

#[derive(Serialize)]
pub(super) struct QueryRequest<'a, A: Serialize + ?Sized> {
    pub(super) path: &'a str,
    pub(super) args: &'a A,
    pub(super) format: &'static str,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub(super) enum QueryResponse {
    Success {
        value: Value,
    },
    Error {
        #[serde(rename = "errorMessage")]
        error_message: String,
        #[serde(rename = "errorData", default)]
        error_data: Option<Value>,
    },
}

#[derive(Serialize)]
pub(super) struct NoArgs {}

pub(crate) fn is_retryable_status(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::TOO_MANY_REQUESTS | StatusCode::SERVICE_UNAVAILABLE
    )
}

pub(crate) fn should_retry(status: StatusCode, retries_so_far: u32) -> bool {
    is_retryable_status(status) && retries_so_far < MAX_RETRIES
}

pub(crate) fn retry_delay(retry_after: Option<&str>) -> Duration {
    let seconds = retry_after
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(DEFAULT_RETRY_DELAY_SECS)
        .clamp(MIN_RETRY_DELAY_SECS, MAX_RETRY_DELAY_SECS);
    Duration::from_secs(seconds)
}

pub(crate) fn transport_message(timed_out: bool, offline: bool) -> &'static str {
    if timed_out {
        TIMED_OUT_MESSAGE
    } else if offline {
        OFFLINE_MESSAGE
    } else {
        UNREACHABLE_MESSAGE
    }
}

pub(super) fn user_error(
    function: &str,
    message: &str,
    detail: impl std::fmt::Display,
) -> anyhow::Error {
    leptos::logging::warn!("MeetCal request for {function} failed: {detail}");
    anyhow!(message.to_owned())
}

pub(super) const TIMER_ROUNDING_MS: f64 = 50.0;

pub(super) fn request_used_its_whole_timeout(elapsed_ms: f64, timeout: Duration) -> bool {
    elapsed_ms + TIMER_ROUNDING_MS >= timeout.as_secs_f64() * 1000.0
}

pub(super) fn body_read_failed_at_the_timeout(
    error: &reqwest::Error,
    started_at_ms: f64,
    timeout: Duration,
) -> bool {
    error.is_timeout()
        || request_used_its_whole_timeout(js_sys::Date::now() - started_at_ms, timeout)
}

pub(super) fn transport_error(
    function: &str,
    error: &reqwest::Error,
    timed_out: bool,
) -> anyhow::Error {
    let offline = web_sys::window().is_some_and(|window| !window.navigator().on_line());
    user_error(
        function,
        transport_message(timed_out, offline),
        format!("{error:?}"),
    )
}

pub(super) fn exhausted_retries_message(status: StatusCode) -> &'static str {
    if status == StatusCode::TOO_MANY_REQUESTS {
        RATE_LIMITED_MESSAGE
    } else {
        OVERLOADED_MESSAGE
    }
}

pub(super) async fn sleep(duration: Duration) {
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

pub(super) fn whole_numbers_as_integers(value: Value) -> Value {
    match value {
        Value::Number(number) => match number.as_f64() {
            Some(float)
                if number.is_f64()
                    && float.fract() == 0.0
                    && (i64::MIN as f64..=i64::MAX as f64).contains(&float) =>
            {
                Value::from(float as i64)
            }
            _ => Value::Number(number),
        },
        Value::Array(items) => items.into_iter().map(whole_numbers_as_integers).collect(),
        Value::Object(fields) => fields
            .into_iter()
            .map(|(key, field)| (key, whole_numbers_as_integers(field)))
            .collect(),
        unchanged @ (Value::Null | Value::Bool(_) | Value::String(_)) => unchanged,
    }
}

pub(super) fn answer_value(response: QueryResponse) -> Result<Value> {
    match response {
        QueryResponse::Success { value } => Ok(value),
        QueryResponse::Error {
            error_message,
            error_data,
        } => {
            let reason = error_data
                .as_ref()
                .and_then(|data| data.get("error"))
                .and_then(Value::as_str)
                .unwrap_or(&error_message);
            Err(anyhow!("MeetCal could not answer: {reason}"))
        }
    }
}

pub(super) fn function_error_status(response: &QueryResponse) -> Option<u16> {
    let QueryResponse::Error {
        error_data: Some(data),
        ..
    } = response
    else {
        return None;
    };
    data.get("status")
        .and_then(Value::as_f64)
        .filter(|status| status.fract() == 0.0 && (0.0..=f64::from(u16::MAX)).contains(status))
        .map(|status| status as u16)
}

#[derive(Clone, Copy)]
pub(super) enum Endpoint {
    Query,
    Mutation,
    Action,
}

impl Endpoint {
    pub(super) fn retries(self) -> bool {
        !matches!(self, Endpoint::Mutation)
    }
}

pub(super) async fn post(
    endpoint: Endpoint,
    function: &str,
    args: &Value,
    token: Option<&str>,
) -> Result<QueryResponse> {
    post_within(endpoint, function, args, token, REQUEST_TIMEOUT).await
}

pub(super) async fn post_within(
    endpoint: Endpoint,
    function: &str,
    args: &Value,
    token: Option<&str>,
    timeout: Duration,
) -> Result<QueryResponse> {
    let client = reqwest::Client::new();
    let url = match endpoint {
        Endpoint::Query => format!("{}/api/query", convex_url()),
        Endpoint::Mutation => format!("{}/api/mutation", convex_url()),
        Endpoint::Action => format!("{}/api/action", convex_url()),
    };
    let request = QueryRequest {
        path: function,
        args,
        format: "json",
    };

    let mut retries = 0;
    let (response, started_at_ms) = loop {
        let started_at_ms = js_sys::Date::now();
        let mut builder = client.post(&url).timeout(timeout).json(&request);
        if let Some(token) = token {
            builder = builder.bearer_auth(token);
        }
        let response = builder
            .send()
            .await
            .map_err(|error| transport_error(function, &error, error.is_timeout()))?;
        let status = response.status();

        if endpoint.retries() && should_retry(status, retries) {
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
        if status != StatusCode::OK && status.as_u16() != FUNCTION_FAILED {
            return Err(user_error(
                function,
                &format!("MeetCal could not answer (HTTP {})", status.as_u16()),
                status,
            ));
        }
        break (response, started_at_ms);
    };

    let body = response.bytes().await.map_err(|error| {
        transport_error(
            function,
            &error,
            body_read_failed_at_the_timeout(&error, started_at_ms, timeout),
        )
    })?;
    serde_json::from_slice::<QueryResponse>(&body)
        .map_err(|error| user_error(function, UNREADABLE_MESSAGE, error))
}

pub(crate) const SESSION_MESSAGE: &str =
    "MeetCal couldn't confirm you're signed in; please sign in again";
