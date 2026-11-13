use crate::utils::http::{self, Failure, OK, Post, SERVICE_UNAVAILABLE, TOO_MANY_REQUESTS};
use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use serde_json::value::RawValue;
use std::time::Duration;
use wasm_bindgen::JsValue;

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
#[serde(try_from = "Envelope")]
pub(super) enum QueryResponse {
    Success {
        value: Box<RawValue>,
    },
    Error {
        error_message: String,
        error_data: Option<Value>,
    },
}

#[derive(Deserialize)]
pub(super) struct Envelope {
    status: String,
    #[serde(default)]
    value: Option<Box<RawValue>>,
    #[serde(rename = "errorMessage", default)]
    error_message: Option<String>,
    #[serde(rename = "errorData", default)]
    error_data: Option<Value>,
}

impl TryFrom<Envelope> for QueryResponse {
    type Error = String;

    fn try_from(envelope: Envelope) -> Result<Self, String> {
        match envelope.status.as_str() {
            "success" => Ok(Self::Success {
                value: match envelope.value {
                    Some(value) => value,
                    None => RawValue::from_string("null".to_owned())
                        .map_err(|error| error.to_string())?,
                },
            }),
            "error" => Ok(Self::Error {
                error_message: envelope
                    .error_message
                    .ok_or_else(|| "an error answer without errorMessage".to_owned())?,
                error_data: envelope.error_data,
            }),
            other => Err(format!("unknown answer status {other}")),
        }
    }
}

#[derive(Serialize)]
pub(super) struct NoArgs {}

pub(crate) fn is_retryable_status(status: u16) -> bool {
    matches!(status, TOO_MANY_REQUESTS | SERVICE_UNAVAILABLE)
}

pub(crate) fn should_retry(status: u16, retries_so_far: u32) -> bool {
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

pub(super) fn transport_error(function: &str, failure: &Failure) -> anyhow::Error {
    let offline = web_sys::window().is_some_and(|window| !window.navigator().on_line());
    user_error(
        function,
        transport_message(matches!(failure, Failure::TimedOut), offline),
        match failure {
            Failure::TimedOut => "no answer before the timeout",
            Failure::Unreachable(reason) => reason,
        },
    )
}

pub(super) fn exhausted_retries_message(status: u16) -> &'static str {
    if status == TOO_MANY_REQUESTS {
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

pub(super) fn answer_value(response: QueryResponse) -> Result<Box<RawValue>> {
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

pub(super) fn answer_json(response: QueryResponse) -> Result<Value> {
    let value = answer_value(response)?;
    serde_json::from_str(value.get()).map_err(|error| anyhow!("unreadable answer: {error}"))
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
    let url = match endpoint {
        Endpoint::Query => format!("{}/api/query", convex_url()),
        Endpoint::Mutation => format!("{}/api/mutation", convex_url()),
        Endpoint::Action => format!("{}/api/action", convex_url()),
    };
    let request = serde_json::to_string(&QueryRequest {
        path: function,
        args,
        format: "json",
    })
    .map_err(|error| user_error(function, UNREACHABLE_MESSAGE, error))?;

    let mut retries = 0;
    let reply = loop {
        let reply = http::post(Post {
            url: &url,
            body: JsValue::from_str(&request),
            content_type: "application/json",
            bearer: token,
            timeout,
        })
        .await
        .map_err(|failure| transport_error(function, &failure))?;

        if endpoint.retries() && should_retry(reply.status, retries) {
            sleep(retry_delay(reply.retry_after.as_deref())).await;
            retries += 1;
            continue;
        }
        if is_retryable_status(reply.status) {
            return Err(anyhow!(exhausted_retries_message(reply.status)));
        }
        if reply.status != OK && reply.status != FUNCTION_FAILED {
            return Err(user_error(
                function,
                &format!("MeetCal could not answer (HTTP {})", reply.status),
                reply.status,
            ));
        }
        break reply;
    };

    serde_json::from_str::<QueryResponse>(&reply.body)
        .map_err(|error| user_error(function, UNREADABLE_MESSAGE, error))
}

pub(crate) const SESSION_MESSAGE: &str =
    "MeetCal couldn't confirm you're signed in; please sign in again";
