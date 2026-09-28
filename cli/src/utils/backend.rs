//! Access to MeetCal's data: the Convex queries in `convex/` at the repository root, the same
//! ones the app and the website read, called over Convex's HTTP API (`POST /api/query`).
//!
//! Every request goes through [`send_with_retry`], which uses one shared client and applies the
//! policy in `utils::retry`.

use std::sync::OnceLock;
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use reqwest::{Client, Request, Response, StatusCode, header::RETRY_AFTER};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;

use crate::utils::retry::{next_retry_delay, parse_retry_after_secs};

/// The production Convex deployment, which the app and the website read too.
pub const CONVEX_URL: &str = "https://disciplined-hare-790.convex.cloud";

/// Environment variable that points the CLI at another deployment (a dev one).
pub const CONVEX_URL_ENV: &str = "MEETCAL_CONVEX_URL";

/// User-Agent sent with every request.
pub const USER_AGENT: &str = concat!("meetcal-cli/", env!("CARGO_PKG_VERSION"));

/// Time allowed to establish a connection.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Time allowed for a whole request, from connecting to reading the body.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Convex answers a function that ran but failed with this status (or 200).
const FUNCTION_FAILED: u16 = 560;

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

/// The deployment to read: `MEETCAL_CONVEX_URL` when set, production otherwise.
pub fn convex_url() -> String {
    std::env::var(CONVEX_URL_ENV)
        .ok()
        .filter(|url| !url.trim().is_empty())
        .unwrap_or_else(|| CONVEX_URL.to_string())
}

/// How a query's answer carries its body.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Body {
    /// The answer is the body.
    Value,
    /// The answer is `{ json }` or `{ etag, json }`: the body as JSON text, which Convex serves
    /// faster than the same rows as values.
    JsonText,
}

/// A Convex query the CLI reads.
#[derive(Clone, Copy, Debug)]
pub struct Query {
    /// `module:function`, e.g. `reference:records` for `convex/reference.ts`.
    pub function: &'static str,
    pub body: Body,
}

impl Query {
    const fn value(function: &'static str) -> Self {
        Self {
            function,
            body: Body::Value,
        }
    }

    const fn text(function: &'static str) -> Self {
        Self {
            function,
            body: Body::JsonText,
        }
    }
}

/// Every Convex query the CLI reads, each named for the Rust API route it replaced. Arguments
/// are the queries' own, in camelCase.
pub mod queries {
    use super::Query;

    /// `GET /meets/athletes`; takes `meet`.
    pub const MEET_ATHLETES: Query = Query::text("meets:athletes");
    /// `GET /meets/athletes-sessions`; takes `meet`, and optionally `sessionNumber` and
    /// `platform`.
    pub const MEET_ATHLETES_SESSIONS: Query = Query::text("meets:athletesSessions");
    /// `GET /lifting-results`; takes `meet`.
    pub const MEET_RESULTS: Query = Query::text("results:byMeet");
    /// `GET /lifting-results/by-names`; takes `names` (at most 100).
    pub const RESULTS_BY_NAMES: Query = Query::text("results:byNames");
    /// `GET /lifting-results/recent`; takes `names` (at most 100) and `cutoffDate`.
    pub const RECENT_RESULTS: Query = Query::text("results:recent");
    /// `GET /search`; takes `query`, and optionally `startDate` and `endDate`.
    pub const SEARCH: Query = Query::value("results:search");
    /// `GET /data/records`
    pub const RECORDS: Query = Query::text("reference:records");
    /// `GET /data/standards`
    pub const STANDARDS: Query = Query::text("reference:standards");
    /// `GET /data/qualifying-totals`
    pub const QUALIFYING_TOTALS: Query = Query::text("reference:qualifyingTotals");
    /// `GET /data/intl-rankings`
    pub const INTL_RANKINGS: Query = Query::text("reference:intlRankings");
    /// `GET /data/nat-rankings`; takes `federation` and `ageCategory`.
    pub const NATIONAL_RANKINGS: Query = Query::text("reference:nationalRankings");
    /// `GET /data/nat-rankings-year`; also takes `year`.
    pub const NATIONAL_RANKINGS_BY_YEAR: Query = Query::text("reference:nationalRankingsByYear");
    /// `GET /data/wso/records`; takes `wso`, and optionally `ageCategory` and `gender`.
    pub const WSO_RECORDS: Query = Query::text("reference:wsoRecords");
    /// `GET /data/adaptive`; takes `gender` and `excludeFederation`.
    pub const ADAPTIVE_RECORDS: Query = Query::text("reference:adaptiveRecords");
    /// `GET /clubs/athletes`; takes `club`.
    pub const CLUB_ATHLETES: Query = Query::value("reference:clubAthletes");
    /// `GET /clubs/meet-stats`; takes `club` and `meet`.
    pub const CLUB_MEET_STATS: Query = Query::value("reference:clubMeetStats");
    /// `GET /wsos/athletes`; takes `wso`.
    pub const WSO_ATHLETES: Query = Query::text("reference:wsoAthletes");
}

#[derive(Serialize)]
struct QueryRequest<'a, A: Serialize + ?Sized> {
    path: &'a str,
    args: &'a A,
    format: &'static str,
}

/// Convex's answer to `POST /api/query`.
#[derive(Debug, Deserialize)]
#[serde(tag = "status", rename_all = "lowercase")]
enum QueryResponse {
    Success {
        value: Value,
    },
    Error {
        #[serde(rename = "errorMessage")]
        error_message: String,
        /// A `ConvexError`'s data: our functions throw `{ status, error }`.
        #[serde(rename = "errorData", default)]
        error_data: Option<Value>,
    },
}

/// The arguments of a query that takes none.
#[derive(Serialize)]
pub struct NoArgs {}

/// Runs `query` with `args` on the production deployment (or `MEETCAL_CONVEX_URL`).
pub async fn query<T, A>(query: Query, args: &A) -> Result<T>
where
    T: DeserializeOwned,
    A: Serialize + ?Sized,
{
    query_from(&convex_url(), query, args).await
}

/// Runs `query` with `args` on the deployment at `base_url`.
pub async fn query_from<T, A>(base_url: &str, query: Query, args: &A) -> Result<T>
where
    T: DeserializeOwned,
    A: Serialize + ?Sized,
{
    let request = client()?
        .post(format!("{}/api/query", base_url.trim_end_matches('/')))
        .json(&QueryRequest {
            path: query.function,
            args,
            format: "json",
        })
        .build()
        .with_context(|| {
            format!(
                "Failed to build request for MeetCal query {}",
                query.function
            )
        })?;

    let answer: QueryResponse = send_with_retry(request, query.function)
        .await?
        .json()
        .await
        .with_context(|| format!("Failed to parse MeetCal's answer to {}", query.function))?;
    read_answer(query, answer)
}

/// Convex's HTTP API writes every number of a value answer as a float (`2.0`), which an integer
/// field will not accept; whole numbers become integers again. (JSON text answers are the
/// server's own `JSON.stringify`, which already writes `2`.)
fn whole_numbers_as_integers(value: Value) -> Value {
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
        other => other,
    }
}

/// The body a query answered, or why it has none.
fn read_answer<T: DeserializeOwned>(query: Query, answer: QueryResponse) -> Result<T> {
    let value = match answer {
        QueryResponse::Success { value } => value,
        QueryResponse::Error {
            error_message,
            error_data,
        } => {
            let reason = error_data
                .as_ref()
                .and_then(|data| data.get("error"))
                .and_then(Value::as_str)
                .unwrap_or(&error_message);
            return Err(anyhow!(
                "MeetCal could not answer {}: {reason}",
                query.function
            ));
        }
    };
    match query.body {
        Body::Value => serde_json::from_value(whole_numbers_as_integers(value))
            .with_context(|| format!("Unexpected answer from MeetCal query {}", query.function)),
        Body::JsonText => {
            let text = value.get("json").and_then(Value::as_str).ok_or_else(|| {
                anyhow!("MeetCal query {} answered without its body", query.function)
            })?;
            serde_json::from_str(text)
                .with_context(|| format!("Unexpected answer from MeetCal query {}", query.function))
        }
    }
}

/// Sends `request`, retrying rate limited (429) and overloaded (503) responses as the retry
/// policy allows. Returns the response once Convex answers (a function that failed included),
/// or an error once it cannot.
pub async fn send_with_retry(request: Request, function: &str) -> Result<Response> {
    let mut retries_done = 0;

    loop {
        let attempt = request
            .try_clone()
            .with_context(|| format!("Failed to prepare request for MeetCal query {function}"))?;
        let response = client()?
            .execute(attempt)
            .await
            .with_context(|| format!("Failed to call MeetCal query {function}"))?;

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
                "MeetCal query {function} returned {status} after {retries_done} retries"
            )
            .context(rate_limited_message(retry_after_secs)));
        }

        if status.as_u16() == FUNCTION_FAILED {
            return Ok(response);
        }
        return response
            .error_for_status()
            .with_context(|| format!("MeetCal query {function} returned an error"));
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
    use serde_json::json;

    fn answer(value: Value) -> QueryResponse {
        serde_json::from_value(value).unwrap()
    }

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
    fn value_answers_are_the_body() {
        let rows: Vec<String> = read_answer(
            Query::value("test:value"),
            answer(json!({"status": "success", "value": ["a", "b"], "logLines": []})),
        )
        .unwrap();
        assert_eq!(rows, ["a", "b"]);
    }

    #[test]
    fn whole_numbers_in_value_answers_fit_integer_fields() {
        #[derive(Deserialize)]
        struct Stats {
            gold_medals: u64,
            total_weight_lifted: f64,
            snatch_make_rate: i64,
        }
        let stats: Stats = read_answer(
            Query::value("reference:clubMeetStats"),
            answer(json!({"status": "success", "value": {
                "gold_medals": 3.0, "total_weight_lifted": 74.5, "snatch_make_rate": 67.0
            }})),
        )
        .unwrap();
        assert_eq!(stats.gold_medals, 3);
        assert_eq!(stats.total_weight_lifted, 74.5);
        assert_eq!(stats.snatch_make_rate, 67);
    }

    #[test]
    fn text_answers_carry_the_body_as_json_text() {
        for value in [
            json!({"json": "[1,2]"}),
            json!({"etag": "\"x\"", "json": "[1,2]"}),
        ] {
            let rows: Vec<u32> = read_answer(
                Query::text("test:text"),
                answer(json!({"status": "success", "value": value})),
            )
            .unwrap();
            assert_eq!(rows, [1, 2]);
        }
    }

    #[test]
    fn a_text_answer_without_its_body_is_an_error() {
        let error = read_answer::<Vec<u32>>(
            Query::text("test:text"),
            answer(json!({"status": "success", "value": {"etag": "\"x\""}})),
        )
        .unwrap_err();
        assert_eq!(
            error.to_string(),
            "MeetCal query test:text answered without its body"
        );
    }

    #[test]
    fn function_errors_explain_themselves() {
        let error = read_answer::<Value>(
            Query::value("reference:nationalRankingsByYear"),
            answer(json!({
                "status": "error",
                "errorMessage": "Server Error",
                "errorData": {"status": 400, "error": "year must be a four-digit year"}
            })),
        )
        .unwrap_err();
        assert_eq!(
            error.to_string(),
            "MeetCal could not answer reference:nationalRankingsByYear: year must be a four-digit year"
        );
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
