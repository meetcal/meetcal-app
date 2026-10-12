//! The site's one way to read MeetCal data: the Convex queries in `convex/`,
//! called over Convex's HTTP API (`POST /api/query`), the same queries the app
//! reads. Every call is a read, so repeating one is safe.

use anyhow::{Context, Result, anyhow};
use reqwest::{StatusCode, header::RETRY_AFTER};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use std::time::Duration;

/// The production deployment, which the app reads too. A build can read
/// another deployment (a dev one) by setting `MEETCAL_CONVEX_URL`.
const PRODUCTION_CONVEX_URL: &str = "https://disciplined-hare-790.convex.cloud";

/// Retries allowed after the first attempt for a throttled or overloaded response.
pub(crate) const MAX_RETRIES: u32 = 2;
/// Wait used when a retryable response has no usable `Retry-After` value.
const DEFAULT_RETRY_DELAY_SECS: u64 = 1;
/// Bounds applied to `Retry-After` so an interactive page never stalls for long.
const MIN_RETRY_DELAY_SECS: u64 = 1;
const MAX_RETRY_DELAY_SECS: u64 = 10;

/// Convex answers a function that ran but failed with this status (or 200).
const FUNCTION_FAILED: u16 = 560;

/// Most pages `query_all_pages` reads before giving up. A club's entries
/// arrive 2,000 rows a page, so this allows 200,000 rows; an answer that never
/// reports `isDone` fails here instead of looping forever.
pub(crate) const MAX_PAGES: usize = 100;

pub(crate) const RATE_LIMITED_MESSAGE: &str =
    "Too many requests right now; please try again in a moment";
pub(crate) const OVERLOADED_MESSAGE: &str =
    "MeetCal is busy right now; please try again in a moment";

fn convex_url() -> &'static str {
    option_env!("MEETCAL_CONVEX_URL")
        .filter(|url| !url.is_empty())
        .unwrap_or(PRODUCTION_CONVEX_URL)
}

/// How a query's answer carries its body.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Body {
    /// The answer is the body.
    Value,
    /// The answer is `{ json }` or `{ etag, json }`: the body as JSON text,
    /// which Convex serves faster than the same rows as values.
    JsonText,
}

/// A Convex query the site reads.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Query {
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

/// Every Convex query the site reads, each named for the Rust API route it
/// replaced. Arguments are the queries' own, in camelCase.
pub(crate) mod queries {
    use super::Query;

    /// `GET /meets`; takes `now` (see `UpcomingMeetsQuery`).
    pub(crate) const UPCOMING_MEETS: Query = Query::text("meets:list");
    /// `GET /meets/completed`
    pub(crate) const COMPLETED_MEETS: Query = Query::text("meets:completed");
    /// `GET /meets/schedule`; takes `meet`.
    pub(crate) const MEET_SCHEDULE: Query = Query::text("meets:schedule");
    /// `GET /meets/athletes`; takes `meet`.
    pub(crate) const MEET_ATHLETES: Query = Query::text("meets:athletes");
    /// `GET /meets/athletes-sessions`; takes `meet`.
    pub(crate) const MEET_ATHLETES_SESSIONS: Query = Query::text("meets:athletesSessions");
    /// `GET /lifting-results`; takes `meet`.
    pub(crate) const MEET_RESULTS: Query = Query::text("results:byMeet");
    /// `GET /search`; takes `query`, and optionally `startDate` and `endDate`.
    pub(crate) const SEARCH: Query = Query::value("results:search");
    /// `GET /data/records`
    pub(crate) const RECORDS: Query = Query::text("reference:records");
    /// `GET /data/standards`
    pub(crate) const STANDARDS: Query = Query::text("reference:standards");
    /// `GET /data/qualifying-totals`
    pub(crate) const QUALIFYING_TOTALS: Query = Query::text("reference:qualifyingTotals");
    /// `GET /data/intl-rankings`
    pub(crate) const INTL_RANKINGS: Query = Query::text("reference:intlRankings");
    /// `GET /data/nat-rankings`; takes `federation` and `ageCategory`.
    pub(crate) const NATIONAL_RANKINGS: Query = Query::text("reference:nationalRankings");
    /// `GET /data/nat-rankings-year`; also takes `year`.
    pub(crate) const NATIONAL_RANKINGS_BY_YEAR: Query =
        Query::text("reference:nationalRankingsByYear");
    /// `GET /data/wso`
    pub(crate) const WSO_LIST: Query = Query::text("reference:wsoList");
    /// `GET /data/wso/records`; takes `wso`.
    pub(crate) const WSO_RECORDS: Query = Query::text("reference:wsoRecords");
    /// `GET /data/adaptive`; takes `gender` and `excludeFederation`.
    pub(crate) const ADAPTIVE_RECORDS: Query = Query::text("reference:adaptiveRecords");
    /// `GET /clubs`
    pub(crate) const CLUBS: Query = Query::text("reference:clubs");
    /// `GET /clubs/athletes`; takes `club`. Paged: read it with `query_all_pages`.
    pub(crate) const CLUB_ATHLETES: Query = Query::text("reference:clubAthletes");
    /// `GET /clubs/meet-stats`; takes `club` and `meet`.
    pub(crate) const CLUB_MEET_STATS: Query = Query::value("reference:clubMeetStats");
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
struct NoArgs {}

/// A paged query's own arguments plus `cursor`: `None` (sent as `null`) asks
/// for the first page.
#[derive(Serialize)]
struct PagedArgs<'a, A: Serialize + ?Sized> {
    #[serde(flatten)]
    args: &'a A,
    cursor: Option<&'a str>,
}

/// One page of a paged query: its rows, and where the next page starts.
#[derive(Debug)]
struct Page<T> {
    rows: Vec<T>,
    cursor: String,
    is_done: bool,
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

/// The value a query answered, or why it has none.
fn answer_value(response: QueryResponse) -> Result<Value> {
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

/// The body a query answered, or why it has none.
fn read_response<T: DeserializeOwned>(query: Query, response: QueryResponse) -> Result<T> {
    read_body(query, answer_value(response)?)
}

/// The body inside a query's answer value.
fn read_body<T: DeserializeOwned>(query: Query, value: Value) -> Result<T> {
    match query.body {
        Body::Value => serde_json::from_value(whole_numbers_as_integers(value))
            .with_context(|| format!("MeetCal sent an unexpected answer to {}", query.function)),
        Body::JsonText => {
            let text = value
                .get("json")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("MeetCal sent {} without its body", query.function))?;
            serde_json::from_str(text)
                .with_context(|| format!("MeetCal sent an unexpected answer to {}", query.function))
        }
    }
}

/// One page of a paged query's answer, `{ json, cursor, isDone }`.
fn read_page<T: DeserializeOwned>(query: Query, response: QueryResponse) -> Result<Page<T>> {
    let value = answer_value(response)?;
    let cursor = value
        .get("cursor")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            anyhow!(
                "MeetCal sent a page of {} without its cursor",
                query.function
            )
        })?
        .to_owned();
    let is_done = value
        .get("isDone")
        .and_then(Value::as_bool)
        .ok_or_else(|| anyhow!("MeetCal sent a page of {} without isDone", query.function))?;
    let rows = read_body(query, value)?;
    Ok(Page {
        rows,
        cursor,
        is_done,
    })
}

/// Runs `query` with `args`, retrying throttled (429) and overloaded (503)
/// responses.
pub(crate) async fn query_with<T, A>(query: Query, args: &A) -> Result<T>
where
    T: DeserializeOwned,
    A: Serialize + ?Sized,
{
    read_response(query, send(query, args).await?)
}

/// Every row of a paged query: the first call sends `cursor: null`, each later
/// one the cursor the previous page returned, until a page reports `isDone`.
/// Rows come in page order; the server sorts within a page only, and a list
/// replaced while paging can repeat a row, so callers must not rely on order
/// or uniqueness.
pub(crate) async fn query_all_pages<T, A>(query: Query, args: &A) -> Result<Vec<T>>
where
    T: DeserializeOwned,
    A: Serialize + ?Sized,
{
    collect_pages(query.function, |cursor| async move {
        let args = PagedArgs {
            args,
            cursor: cursor.as_deref(),
        };
        read_page(query, send(query, &args).await?)
    })
    .await
}

/// The paging loop of `query_all_pages`, over any page source: `fetch` gets
/// `None` first, then each cursor a page returned, at most `MAX_PAGES` times.
async fn collect_pages<T, F, Fut>(function: &str, mut fetch: F) -> Result<Vec<T>>
where
    F: FnMut(Option<String>) -> Fut,
    Fut: Future<Output = Result<Page<T>>>,
{
    let mut rows = Vec::new();
    let mut cursor: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let page = fetch(cursor.take()).await?;
        rows.extend(page.rows);
        if page.is_done {
            return Ok(rows);
        }
        cursor = Some(page.cursor);
    }
    Err(anyhow!(
        "MeetCal sent {function} in more than {MAX_PAGES} pages"
    ))
}

/// Sends `query` with `args`, retrying throttled (429) and overloaded (503)
/// responses, and returns Convex's answer.
async fn send<A>(query: Query, args: &A) -> Result<QueryResponse>
where
    A: Serialize + ?Sized,
{
    let client = reqwest::Client::new();
    let url = format!("{}/api/query", convex_url());
    let request = QueryRequest {
        path: query.function,
        args,
        format: "json",
    };

    let mut retries = 0;
    let response = loop {
        let response = client
            .post(&url)
            .json(&request)
            .send()
            .await
            .with_context(|| format!("Could not reach MeetCal for {}", query.function))?;
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
        if status != StatusCode::OK && status.as_u16() != FUNCTION_FAILED {
            return Err(anyhow!(
                "MeetCal could not answer {} (HTTP {status})",
                query.function
            ));
        }
        break response;
    };

    response
        .json::<QueryResponse>()
        .await
        .with_context(|| format!("MeetCal sent an unreadable answer to {}", query.function))
}

/// Runs `query`, which takes no arguments.
pub(crate) async fn query<T: DeserializeOwned>(query: Query) -> Result<T> {
    query_with(query, &NoArgs {}).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn answer(value: Value) -> QueryResponse {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn production_builds_read_the_production_deployment() {
        if option_env!("MEETCAL_CONVEX_URL").is_none() {
            assert_eq!(convex_url(), PRODUCTION_CONVEX_URL);
        }
    }

    #[test]
    fn requests_name_the_function_and_its_arguments_as_json() {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Args {
            age_category: &'static str,
        }
        let body = serde_json::to_value(QueryRequest {
            path: queries::NATIONAL_RANKINGS.function,
            args: &Args {
                age_category: "Open Men's 60kg",
            },
            format: "json",
        })
        .unwrap();
        assert_eq!(
            body,
            json!({"path": "reference:nationalRankings", "args": {"ageCategory": "Open Men's 60kg"}, "format": "json"})
        );
        assert_eq!(serde_json::to_value(NoArgs {}).unwrap(), json!({}));
    }

    #[test]
    fn value_answers_are_the_body() {
        let rows: Vec<String> = read_response(
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
        let stats: Stats = read_response(
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
            let rows: Vec<u32> = read_response(
                Query::text("test:text"),
                answer(json!({"status": "success", "value": value})),
            )
            .unwrap();
            assert_eq!(rows, [1, 2]);
        }
    }

    #[test]
    fn a_text_answer_without_its_body_is_an_error() {
        let error = read_response::<Vec<u32>>(
            Query::text("test:text"),
            answer(json!({"status": "success", "value": {"etag": "\"x\""}})),
        )
        .unwrap_err();
        assert_eq!(error.to_string(), "MeetCal sent test:text without its body");
    }

    /// Runs a future that never waits, as every page source in these tests is.
    fn ready<F: Future>(future: F) -> F::Output {
        let mut context = std::task::Context::from_waker(std::task::Waker::noop());
        match std::pin::pin!(future).poll(&mut context) {
            std::task::Poll::Ready(output) => output,
            std::task::Poll::Pending => panic!("the page source waited"),
        }
    }

    fn page(rows: &[u32], cursor: &str, is_done: bool) -> Page<u32> {
        Page {
            rows: rows.to_vec(),
            cursor: cursor.to_owned(),
            is_done,
        }
    }

    #[test]
    fn paged_requests_add_the_cursor_to_the_arguments() {
        #[derive(Serialize)]
        struct Args {
            club: &'static str,
        }
        let args = Args {
            club: "Test Barbell",
        };
        let first = PagedArgs {
            args: &args,
            cursor: None,
        };
        let later = PagedArgs {
            args: &args,
            cursor: Some("c1"),
        };
        assert_eq!(
            serde_json::to_value(first).unwrap(),
            json!({"club": "Test Barbell", "cursor": null})
        );
        assert_eq!(
            serde_json::to_value(later).unwrap(),
            json!({"club": "Test Barbell", "cursor": "c1"})
        );
    }

    #[test]
    fn a_page_carries_its_rows_as_json_text_with_its_cursor() {
        let page: Page<u32> = read_page(
            queries::CLUB_ATHLETES,
            answer(json!({"status": "success", "value": {"json": "[1,2]", "cursor": "c1", "isDone": false}})),
        )
        .unwrap();
        assert_eq!(page.rows, [1, 2]);
        assert_eq!(page.cursor, "c1");
        assert!(!page.is_done);
    }

    #[test]
    fn a_malformed_page_is_an_error() {
        for (value, message) in [
            (
                json!([1, 2]),
                "MeetCal sent a page of reference:clubAthletes without its cursor",
            ),
            (
                json!({"json": "[]", "isDone": true}),
                "MeetCal sent a page of reference:clubAthletes without its cursor",
            ),
            (
                json!({"json": "[]", "cursor": "c", "isDone": "yes"}),
                "MeetCal sent a page of reference:clubAthletes without isDone",
            ),
            (
                json!({"cursor": "c", "isDone": true}),
                "MeetCal sent reference:clubAthletes without its body",
            ),
            (
                json!({"json": "{}", "cursor": "c", "isDone": true}),
                "MeetCal sent an unexpected answer to reference:clubAthletes",
            ),
        ] {
            let error = read_page::<u32>(
                queries::CLUB_ATHLETES,
                answer(json!({"status": "success", "value": value})),
            )
            .unwrap_err();
            assert_eq!(error.to_string(), message);
        }
    }

    #[test]
    fn pages_are_read_from_a_null_cursor_until_one_is_done() {
        let mut pages = vec![
            page(&[3], "c1", false),
            page(&[], "c2", false),
            page(&[2, 1], "c3", true),
        ]
        .into_iter();
        let mut cursors = Vec::new();
        let rows = ready(collect_pages("test:paged", |cursor| {
            cursors.push(cursor);
            let next = pages.next().expect("no more pages");
            async move { Ok(next) }
        }))
        .unwrap();
        assert_eq!(rows, [3, 2, 1]);
        assert_eq!(
            cursors,
            [None, Some("c1".to_owned()), Some("c2".to_owned())]
        );
    }

    #[test]
    fn paging_stops_at_the_page_limit() {
        let mut calls = 0;
        let error = ready(collect_pages("test:paged", |_| {
            calls += 1;
            let next = page(&[calls], &format!("c{calls}"), false);
            async move { Ok(next) }
        }))
        .unwrap_err();
        assert_eq!(calls as usize, MAX_PAGES);
        assert_eq!(
            error.to_string(),
            format!("MeetCal sent test:paged in more than {MAX_PAGES} pages")
        );

        let mut calls = 0;
        let rows = ready(collect_pages("test:paged", |_| {
            calls += 1;
            let next = page(&[calls], "c", calls as usize == MAX_PAGES);
            async move { Ok(next) }
        }))
        .unwrap();
        assert_eq!(rows.len(), MAX_PAGES);
    }

    #[test]
    fn a_failed_page_fails_the_whole_read() {
        let mut calls = 0;
        let error = ready(collect_pages::<u32, _, _>("test:paged", |_| {
            calls += 1;
            let result = if calls == 1 {
                Ok(page(&[1], "c1", false))
            } else {
                Err(anyhow!("MeetCal could not answer: boom"))
            };
            async move { result }
        }))
        .unwrap_err();
        assert_eq!(calls, 2);
        assert_eq!(error.to_string(), "MeetCal could not answer: boom");
    }

    #[test]
    fn function_errors_explain_themselves() {
        let error = read_response::<Value>(
            Query::value("test:value"),
            answer(json!({
                "status": "error",
                "errorMessage": "[Request ID: 1] Server Error\nUncaught ConvexError: {\"status\":400}",
                "errorData": {"status": 400, "error": "year must be a four-digit year"}
            })),
        )
        .unwrap_err();
        assert_eq!(
            error.to_string(),
            "MeetCal could not answer: year must be a four-digit year"
        );

        let error = read_response::<Value>(
            Query::value("test:value"),
            answer(json!({"status": "error", "errorMessage": "Server Error"})),
        )
        .unwrap_err();
        assert_eq!(error.to_string(), "MeetCal could not answer: Server Error");
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
