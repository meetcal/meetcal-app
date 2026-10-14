//! The site's one way to read MeetCal data: the Convex queries in `convex/`,
//! called over Convex's HTTP API (`POST /api/query`), the same queries the app
//! reads. Every call is a read, so repeating one is safe.
//!
//! The premium queries (`SUBSCRIPTION_FUNCTIONS`) carry the access pass as
//! their `pass` argument. Every subscriber holds the same pass, so premium
//! answers stay in Convex's shared query cache; no query carries the user's
//! session token, which would make Convex cache each answer per user. Only
//! `accessPass:pass`, which hands a signed-in subscriber the pass, and the
//! `entitlements:refresh` action carry the token. For now Convex only logs a
//! premium read without a current pass and still answers it; later it will
//! refuse it, so a premium read sends the pass whenever the site can get one.

use anyhow::{Result, anyhow};
use futures::future::{FutureExt, LocalBoxFuture, Shared};
use reqwest::{StatusCode, header::RETRY_AFTER};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Map, Value};
use std::{cell::RefCell, time::Duration};

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

/// The Convex functions that answer premium data and take the access pass in
/// their `pass` argument: the site sends them the pass it holds. The list is
/// Convex's (`PREMIUM_FUNCTIONS` in `convex/lib/access.ts`, compared to this
/// one by a test there), including functions the site does not call yet, so a
/// page that starts calling one sends the pass without another change.
/// `results:search` needs it only with dates (`carries_pass`): name
/// suggestions are public.
pub(crate) const SUBSCRIPTION_FUNCTIONS: &[&str] = &[
    "reference:records",
    "reference:standards",
    "reference:qualifyingTotals",
    "reference:intlRankings",
    "reference:nationalRankings",
    "reference:nationalRankingsByYear",
    "reference:wsoList",
    "reference:registrationWsos",
    "reference:wsoAgeGroups",
    "reference:wsoRecords",
    "reference:adaptiveRecords",
    "reference:clubs",
    "reference:clubAthletes",
    "reference:wsoAthletes",
    "reference:clubMeetStats",
    "results:page",
    "results:byMeet",
    "results:byNames",
    "results:recent",
    "results:yearBests",
    "results:bests",
    "results:search",
    "meets:packageForMeet",
];

/// The public query that hands a signed-in subscriber the access pass
/// (`convex/accessPass.ts`): `{ pass, rotatesAt }`, or a function error with
/// status 401 when signed out and 403 when Convex has no active entitlement
/// for the user. It and `REFRESH_ENTITLEMENT` are the only calls that carry
/// the Clerk session token.
const ACCESS_PASS: &str = "accessPass:pass";

/// The argument a premium query takes the access pass in.
const PASS_ARGUMENT: &str = "pass";

/// The query whose pass depends on its arguments, and the arguments that make
/// it premium: a dated search is, a name suggestion is not.
const SEARCH_FUNCTION: &str = "results:search";
const SEARCH_DATE_ARGUMENTS: [&str; 2] = ["startDate", "endDate"];

/// The action that asks RevenueCat for the caller's entitlement and records
/// it in Convex; it answers `{ active }` and refuses an anonymous caller.
/// Called when `accessPass:pass` answers 403, so a subscriber Convex does not
/// know yet (a lifetime purchase never renews, so RevenueCat's webhook alone
/// would never report it) gets the pass on the same read.
const REFRESH_ENTITLEMENT: &str = "entitlements:refresh";

/// Shortest time (ms) a fetched pass is held, whatever its `rotatesAt` says,
/// so a device clock running ahead of Convex's cannot make every premium read
/// fetch a pass again. Convex accepts a pass until the rotation after the one
/// that replaced it, so holding one a little past `rotatesAt` is safe.
const MIN_PASS_HOLD_MS: f64 = 5.0 * 60.0 * 1000.0;

/// Longest time (ms) a premium read waits for a pass fetch, counted from the
/// fetch's start, before going without one. The fetch itself runs on and its
/// pass is held for later reads: on a slow network (or a first fetch that
/// asks RevenueCat), a page never waits on it longer than this.
const PASS_WAIT_MS: f64 = 3000.0;

/// How long (ms) after a failed pass fetch premium reads go out without a
/// pass before one tries again, so a user Convex will not give a pass does
/// not refresh the entitlement on every read (a club's roster is up to 100
/// reads). A read Convex refuses for its pass tries again at once.
const PASS_FETCH_BACKOFF_MS: f64 = 60.0 * 1000.0;

/// Most pages `query_all_pages` reads before giving up. A club's entries
/// arrive 2,000 rows a page, so this allows 200,000 rows; an answer that never
/// reports `isDone` fails here instead of looping forever.
pub(crate) const MAX_PAGES: usize = 100;

pub(crate) const RATE_LIMITED_MESSAGE: &str =
    "Too many requests right now; please try again in a moment";
pub(crate) const OVERLOADED_MESSAGE: &str =
    "MeetCal is busy right now; please try again in a moment";

/// Longest one request may take, from sending it to reading its whole answer.
/// Browser `fetch` has no timeout of its own, so a stalled connection would
/// otherwise leave a page loading for good.
pub(crate) const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

pub(crate) const TIMED_OUT_MESSAGE: &str = "MeetCal took too long to answer; please try again";
pub(crate) const OFFLINE_MESSAGE: &str =
    "You appear to be offline; reconnect and it will load again";
pub(crate) const UNREACHABLE_MESSAGE: &str =
    "MeetCal couldn't be reached; check your connection and try again";
/// An answer this site could not read: malformed JSON, a missing field, or
/// a shape the page does not expect.
pub(crate) const UNREADABLE_MESSAGE: &str =
    "MeetCal sent an answer this page couldn't read; please try again";
/// An answer longer than `MAX_PAGES` pages.
pub(crate) const TOO_MANY_PAGES_MESSAGE: &str =
    "MeetCal sent more of this list than this page can show";

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
    /// Whether this query answers premium data, and so takes the access pass.
    pub(crate) fn is_premium(self) -> bool {
        SUBSCRIPTION_FUNCTIONS.contains(&self.function)
    }

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
    /// `GET /lifting-results`; takes `meet`.
    pub(crate) const MEET_RESULTS: Query = Query::text("results:byMeet");
    /// `GET /search`; takes `query`, and optionally `startDate` and `endDate` (both included).
    /// Answers at most 600 results, the most recent, with `truncated` set when it cut some.
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

/// What to tell a user whose request never got an answer. The function and
/// the underlying error go to the console instead: they mean nothing to a user.
pub(crate) fn transport_message(timed_out: bool, offline: bool) -> &'static str {
    if timed_out {
        TIMED_OUT_MESSAGE
    } else if offline {
        OFFLINE_MESSAGE
    } else {
        UNREACHABLE_MESSAGE
    }
}

/// The error a user sees, `message`, which never names the Convex function:
/// the function and `detail` go to the console instead.
fn user_error(function: &str, message: &str, detail: impl std::fmt::Display) -> anyhow::Error {
    leptos::logging::warn!("MeetCal request for {function} failed: {detail}");
    anyhow!(message.to_owned())
}

/// Whether a failed body read was the request timeout. Reading the body
/// rejects with the abort reason reqwest gave its timer, which reqwest
/// reports as a decode error rather than a timeout.
fn body_read_timed_out(detail: &str) -> bool {
    detail.contains("reqwest::errors::TimedOut")
}

fn transport_error(function: &str, error: &reqwest::Error) -> anyhow::Error {
    let timed_out = error.is_timeout() || body_read_timed_out(&format!("{error:?}"));
    let offline = web_sys::window().is_some_and(|window| !window.navigator().on_line());
    user_error(
        function,
        transport_message(timed_out, offline),
        format!("{error:?}"),
    )
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
            .map_err(|error| user_error(query.function, UNREADABLE_MESSAGE, error)),
        Body::JsonText => {
            let text = value.get("json").and_then(Value::as_str).ok_or_else(|| {
                user_error(
                    query.function,
                    UNREADABLE_MESSAGE,
                    "answer has no json body",
                )
            })?;
            serde_json::from_str(text)
                .map_err(|error| user_error(query.function, UNREADABLE_MESSAGE, error))
        }
    }
}

/// One page of a paged query's answer, `{ json, cursor, isDone }`.
fn read_page<T: DeserializeOwned>(query: Query, response: QueryResponse) -> Result<Page<T>> {
    let value = answer_value(response)?;
    let cursor = value
        .get("cursor")
        .and_then(Value::as_str)
        .ok_or_else(|| user_error(query.function, UNREADABLE_MESSAGE, "page has no cursor"))?
        .to_owned();
    let is_done = value
        .get("isDone")
        .and_then(Value::as_bool)
        .ok_or_else(|| user_error(query.function, UNREADABLE_MESSAGE, "page has no isDone"))?;
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
    Err(user_error(
        function,
        TOO_MANY_PAGES_MESSAGE,
        format!("more than {MAX_PAGES} pages"),
    ))
}

/// Sends `query` with `args` and returns Convex's answer. A premium read
/// (`carries_pass`) carries the access pass the site holds, fetching one
/// first if it has none, and goes out without one when it cannot get one. If
/// Convex refuses the read for its pass (a function error with status 401,
/// "access pass required", or 403, "access pass expired"), the held pass is
/// dropped and the read goes once more with a fresh one.
async fn send<A>(query: Query, args: &A) -> Result<QueryResponse>
where
    A: Serialize + ?Sized,
{
    let args = serde_json::to_value(args)
        .map_err(|error| user_error(query.function, UNREACHABLE_MESSAGE, error))?;
    if !carries_pass(query, &args) {
        return post(Endpoint::Query, query.function, &args, None).await;
    }
    let pass = current_pass().await;
    let response = post(
        Endpoint::Query,
        query.function,
        &with_pass(&args, pass.as_deref()),
        None,
    )
    .await?;
    if !is_pass_refused(&response) {
        return Ok(response);
    }
    let Some(fresh) = renewed_pass(pass.as_deref()).await else {
        return Ok(response);
    };
    leptos::logging::warn!(
        "Convex refused the access pass for {}; reading again with a fresh one",
        query.function
    );
    post(
        Endpoint::Query,
        query.function,
        &with_pass(&args, Some(&fresh)),
        None,
    )
    .await
}

/// Whether `query`, sent with `args`, takes the access pass: a premium query,
/// except a search without both dates (a name suggestion, which is public).
fn carries_pass(query: Query, args: &Value) -> bool {
    query.is_premium()
        && (query.function != SEARCH_FUNCTION
            || SEARCH_DATE_ARGUMENTS
                .iter()
                .all(|name| args.get(name).is_some_and(|value| !value.is_null())))
}

/// `args` with the access pass added as `pass`; unchanged without a pass.
fn with_pass(args: &Value, pass: Option<&str>) -> Value {
    let mut args = args.clone();
    if let (Some(pass), Some(fields)) = (pass, args.as_object_mut()) {
        fields.insert(PASS_ARGUMENT.to_owned(), Value::from(pass));
    }
    args
}

/// The status a function error carries in its `errorData` (our functions
/// throw `{ status, error }`), if the answer is one.
fn function_error_status(response: &QueryResponse) -> Option<u16> {
    let QueryResponse::Error {
        error_data: Some(data),
        ..
    } = response
    else {
        return None;
    };
    // A value answer writes its numbers as floats (`403.0`).
    data.get("status")
        .and_then(Value::as_f64)
        .filter(|status| status.fract() == 0.0 && (0.0..=f64::from(u16::MAX)).contains(status))
        .map(|status| status as u16)
}

/// Whether Convex refused a premium read for its pass: 401 without one, 403
/// with one it no longer accepts.
fn is_pass_refused(response: &QueryResponse) -> bool {
    matches!(function_error_status(response), Some(401 | 403))
}

/// Where a call goes: `/api/query` or `/api/action`.
#[derive(Clone, Copy)]
enum Endpoint {
    Query,
    Action,
}

/// Posts `function` with `args` to Convex, with `token` as the bearer token
/// when given, retrying throttled (429) and overloaded (503) responses, and
/// returns Convex's answer.
async fn post(
    endpoint: Endpoint,
    function: &str,
    args: &Value,
    token: Option<&str>,
) -> Result<QueryResponse> {
    let client = reqwest::Client::new();
    let url = match endpoint {
        Endpoint::Query => format!("{}/api/query", convex_url()),
        Endpoint::Action => format!("{}/api/action", convex_url()),
    };
    let request = QueryRequest {
        path: function,
        args,
        format: "json",
    };

    let mut retries = 0;
    let response = loop {
        let mut builder = client.post(&url).timeout(REQUEST_TIMEOUT).json(&request);
        if let Some(token) = token {
            builder = builder.bearer_auth(token);
        }
        let response = builder
            .send()
            .await
            .map_err(|error| transport_error(function, &error))?;
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
            return Err(user_error(
                function,
                &format!("MeetCal could not answer (HTTP {})", status.as_u16()),
                status,
            ));
        }
        break response;
    };

    // The timeout covers reading the answer too. A failed read is the
    // connection's fault; only a body that arrives and does not parse is
    // an unreadable answer.
    let body = response
        .bytes()
        .await
        .map_err(|error| transport_error(function, &error))?;
    serde_json::from_slice::<QueryResponse>(&body)
        .map_err(|error| user_error(function, UNREADABLE_MESSAGE, error))
}

/// Runs `query`, which takes no arguments.
pub(crate) async fn query<T: DeserializeOwned>(query: Query) -> Result<T> {
    query_with(query, &NoArgs {}).await
}

/// The access pass Convex hands a subscriber: the pass, and the time (epoch
/// ms) after which it may have rotated.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccessPass {
    pass: String,
    rotates_at: f64,
}

/// What `accessPass:pass` answered.
#[derive(Debug, PartialEq)]
enum PassAnswer {
    Granted(AccessPass),
    /// 403: Convex has no active entitlement for the user (yet).
    SubscriptionRequired,
}

/// Reads `accessPass:pass`'s answer. Any other failure (401 signed out, 503
/// before the first rotation, a malformed pass) is an error.
fn read_pass_answer(response: QueryResponse) -> Result<PassAnswer> {
    if function_error_status(&response) == Some(403) {
        return Ok(PassAnswer::SubscriptionRequired);
    }
    let pass: AccessPass = serde_json::from_value(answer_value(response)?)?;
    if pass.pass.is_empty() || !pass.rotates_at.is_finite() {
        return Err(anyhow!("malformed access pass"));
    }
    Ok(PassAnswer::Granted(pass))
}

/// Asks Convex for the access pass with the user's session token.
async fn request_access_pass(token: &str) -> Result<PassAnswer> {
    let response = post(
        Endpoint::Query,
        ACCESS_PASS,
        &Value::Object(Map::new()),
        Some(token),
    )
    .await?;
    read_pass_answer(response)
}

/// Asks Convex to fetch the signed-in user's entitlement from RevenueCat and
/// record it (`entitlements:refresh`). Answers whether it is active.
async fn refresh_entitlement(token: &str) -> Result<bool> {
    let response = post(
        Endpoint::Action,
        REFRESH_ENTITLEMENT,
        &Value::Object(Map::new()),
        Some(token),
    )
    .await?;
    read_entitlement(response)
}

/// Whether `entitlements:refresh` answered an active entitlement.
fn read_entitlement(response: QueryResponse) -> Result<bool> {
    answer_value(response)?
        .get("active")
        .and_then(Value::as_bool)
        .ok_or_else(|| anyhow!("answer has no active flag"))
}

/// Fetches the access pass for the signed-in user. If Convex has no active
/// entitlement for them, asks it to refresh the entitlement from RevenueCat
/// and, if that finds one, asks for the pass once more. `None` when signed
/// out or when no pass could be had (logged).
async fn fetch_access_pass() -> Option<AccessPass> {
    let token = crate::auth::session_token().await?;
    match request_access_pass(&token).await {
        Ok(PassAnswer::Granted(pass)) => return Some(pass),
        Ok(PassAnswer::SubscriptionRequired) => {}
        Err(error) => {
            leptos::logging::warn!("No access pass: {error}");
            return None;
        }
    }
    match refresh_entitlement(&token).await {
        Ok(true) => {}
        Ok(false) => {
            leptos::logging::warn!("No access pass: Convex found no active entitlement");
            return None;
        }
        Err(error) => {
            leptos::logging::warn!("No access pass: the entitlement refresh failed: {error}");
            return None;
        }
    }
    // The refresh can take a while; Clerk hands over a fresh token if the
    // first one expired meanwhile.
    let token = crate::auth::session_token().await?;
    match request_access_pass(&token).await {
        Ok(PassAnswer::Granted(pass)) => Some(pass),
        Ok(PassAnswer::SubscriptionRequired) => {
            leptos::logging::warn!("No access pass: refused after the entitlement refresh");
            None
        }
        Err(error) => {
            leptos::logging::warn!("No access pass: {error}");
            None
        }
    }
}

/// A pass the site holds, and until when (epoch ms) it is used.
#[derive(Clone, Debug, PartialEq)]
struct HeldPass {
    pass: String,
    until: f64,
}

/// One fetch of the access pass, shared by every read waiting on it.
type PassFetch = Shared<LocalBoxFuture<'static, Option<String>>>;

/// The site's access pass, in memory only: one per page load.
#[derive(Default)]
struct PassState {
    held: Option<HeldPass>,
    /// When the last fetch failed: until `PASS_FETCH_BACKOFF_MS` later, reads
    /// go without a pass instead of fetching again.
    failed_at: Option<f64>,
    /// The running fetch, and when (epoch ms) it started.
    fetching: Option<(PassFetch, f64)>,
    /// Advanced by `forget_access_pass`, so a fetch started before the user
    /// changed does not store its answer.
    generation: u64,
}

thread_local! {
    static ACCESS_PASS_STATE: RefCell<PassState> = RefCell::new(PassState::default());
}

/// Until when a pass that rotates at `rotates_at`, fetched at `now`, is used.
fn held_until(rotates_at: f64, now: f64) -> f64 {
    rotates_at.max(now + MIN_PASS_HOLD_MS)
}

/// The held pass, if it is still in use at `now`.
fn usable_pass(held: Option<&HeldPass>, now: f64) -> Option<&str> {
    held.filter(|held| now < held.until)
        .map(|held| held.pass.as_str())
}

/// Whether a read may start a pass fetch at `now`, given when the last one failed.
fn may_fetch(failed_at: Option<f64>, now: f64) -> bool {
    failed_at.is_none_or(|failed_at| now - failed_at >= PASS_FETCH_BACKOFF_MS)
}

/// What a premium read does to get the pass.
enum PassStep {
    Use(String),
    Join(PassFetch, f64),
    Fetch,
    GoWithout,
}

/// How long (ms) a read may still wait at `now` for a fetch that started at `started_at`.
fn pass_wait_left(started_at: f64, now: f64) -> f64 {
    (started_at + PASS_WAIT_MS - now).max(0.0)
}

/// The fetch's pass, or `None` once the read has waited `PASS_WAIT_MS` from
/// the fetch's start. The fetch keeps running either way.
async fn wait_for_pass(fetch: PassFetch, started_at: f64) -> Option<String> {
    let left = pass_wait_left(started_at, js_sys::Date::now());
    if left <= 0.0 {
        return None;
    }
    let timer = sleep(Duration::from_millis(left as u64));
    match futures::future::select(Box::pin(fetch), Box::pin(timer)).await {
        futures::future::Either::Left((pass, _)) => pass,
        futures::future::Either::Right(_) => None,
    }
}

/// The pass for a premium read: the held one while it is in use, else the
/// fetch already running, else a new fetch (unless one failed recently).
async fn current_pass() -> Option<String> {
    let now = js_sys::Date::now();
    let step = ACCESS_PASS_STATE.with_borrow(|state| {
        if let Some(pass) = usable_pass(state.held.as_ref(), now) {
            PassStep::Use(pass.to_owned())
        } else if let Some((fetch, started_at)) = &state.fetching {
            PassStep::Join(fetch.clone(), *started_at)
        } else if may_fetch(state.failed_at, now) {
            PassStep::Fetch
        } else {
            PassStep::GoWithout
        }
    });
    match step {
        PassStep::Use(pass) => Some(pass),
        PassStep::Join(fetch, started_at) => wait_for_pass(fetch, started_at).await,
        PassStep::Fetch => {
            let (fetch, started_at) = start_pass_fetch();
            wait_for_pass(fetch, started_at).await
        }
        PassStep::GoWithout => None,
    }
}

/// A fresh pass after Convex refused a read sent with `refused` (`None`: sent
/// without one). Drops the held pass if it is the refused one; a different
/// held pass (another read already renewed it) is used as it is. Otherwise
/// joins the running fetch or starts one, even within the backoff.
async fn renewed_pass(refused: Option<&str>) -> Option<String> {
    let now = js_sys::Date::now();
    let step = ACCESS_PASS_STATE.with_borrow_mut(|state| {
        if state.held.as_ref().map(|held| held.pass.as_str()) == refused {
            state.held = None;
        }
        if let Some(pass) = usable_pass(state.held.as_ref(), now) {
            PassStep::Use(pass.to_owned())
        } else if let Some((fetch, started_at)) = &state.fetching {
            PassStep::Join(fetch.clone(), *started_at)
        } else {
            PassStep::Fetch
        }
    });
    match step {
        PassStep::Use(pass) => Some(pass),
        PassStep::Join(fetch, started_at) => wait_for_pass(fetch, started_at).await,
        PassStep::Fetch | PassStep::GoWithout => {
            let (fetch, started_at) = start_pass_fetch();
            wait_for_pass(fetch, started_at).await
        }
    }
}

/// Starts a pass fetch that later reads join, and returns it with when it
/// started. It runs to the end whether or not anyone still waits: its answer
/// is held until `held_until`; a failure starts the backoff.
fn start_pass_fetch() -> (PassFetch, f64) {
    let started_at = js_sys::Date::now();
    let generation = ACCESS_PASS_STATE.with_borrow(|state| state.generation);
    let fetch = async move {
        let fetched = fetch_access_pass().await;
        let now = js_sys::Date::now();
        ACCESS_PASS_STATE.with_borrow_mut(|state| {
            if state.generation != generation {
                return;
            }
            state.fetching = None;
            match &fetched {
                Some(pass) => {
                    state.held = Some(HeldPass {
                        pass: pass.pass.clone(),
                        until: held_until(pass.rotates_at, now),
                    });
                    state.failed_at = None;
                }
                None => state.failed_at = Some(now),
            }
        });
        fetched.map(|pass| pass.pass)
    }
    .boxed_local()
    .shared();
    ACCESS_PASS_STATE.with_borrow_mut(|state| state.fetching = Some((fetch.clone(), started_at)));
    let running = fetch.clone();
    leptos::task::spawn_local(async move {
        running.await;
    });
    (fetch, started_at)
}

/// Forgets the held pass, a failed fetch and any running one: the signed-in
/// user changed, so the next premium read fetches for the new one (or, signed
/// out, finds no session token and goes without).
pub(crate) fn forget_access_pass() {
    ACCESS_PASS_STATE.with_borrow_mut(|state| {
        *state = PassState {
            generation: state.generation + 1,
            ..PassState::default()
        };
    });
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
    fn premium_queries_carry_the_pass_and_the_rest_do_not() {
        let args = json!({"meet": "Test Meet"});
        for query in [
            queries::MEET_RESULTS,
            queries::RECORDS,
            queries::STANDARDS,
            queries::QUALIFYING_TOTALS,
            queries::INTL_RANKINGS,
            queries::NATIONAL_RANKINGS,
            queries::NATIONAL_RANKINGS_BY_YEAR,
            queries::WSO_LIST,
            queries::WSO_RECORDS,
            queries::ADAPTIVE_RECORDS,
            queries::CLUBS,
            queries::CLUB_ATHLETES,
            queries::CLUB_MEET_STATS,
        ] {
            assert!(query.is_premium(), "{}", query.function);
            assert!(carries_pass(query, &args), "{}", query.function);
        }
        // Public, so they go without it.
        for query in [
            queries::UPCOMING_MEETS,
            queries::COMPLETED_MEETS,
            queries::MEET_SCHEDULE,
            queries::MEET_ATHLETES,
        ] {
            assert!(!query.is_premium(), "{}", query.function);
            assert!(!carries_pass(query, &args), "{}", query.function);
        }
        assert_eq!(SUBSCRIPTION_FUNCTIONS.len(), 23);
        assert!(!SUBSCRIPTION_FUNCTIONS.contains(&ACCESS_PASS));
        assert!(!SUBSCRIPTION_FUNCTIONS.contains(&REFRESH_ENTITLEMENT));
    }

    #[test]
    fn only_a_dated_search_carries_the_pass() {
        assert!(queries::SEARCH.is_premium());
        let dated = json!({"query": "Smith", "startDate": "2026-01-01", "endDate": "2026-12-31"});
        assert!(carries_pass(queries::SEARCH, &dated));
        for suggestion in [
            json!({"query": "Smi"}),
            json!({"query": "Smi", "startDate": "2026-01-01"}),
            json!({"query": "Smi", "endDate": "2026-12-31"}),
            json!({"query": "Smi", "startDate": null, "endDate": null}),
        ] {
            assert!(!carries_pass(queries::SEARCH, &suggestion), "{suggestion}");
        }
    }

    #[test]
    fn the_pass_goes_into_the_arguments() {
        let args = json!({"club": "Test Barbell", "cursor": null});
        assert_eq!(
            with_pass(&args, Some("p1")),
            json!({"club": "Test Barbell", "cursor": null, "pass": "p1"})
        );
        assert_eq!(with_pass(&args, None), args);
        assert_eq!(with_pass(&json!({}), Some("p1")), json!({"pass": "p1"}));
    }

    #[test]
    fn only_a_401_or_403_function_error_refuses_the_pass() {
        let error = |data: Value| {
            answer(json!({"status": "error", "errorMessage": "Server Error", "errorData": data}))
        };
        for status in [json!(401), json!(403), json!(403.0)] {
            assert!(
                is_pass_refused(&error(
                    json!({"status": status, "error": "access pass expired"})
                )),
                "{status}"
            );
        }
        for data in [
            json!({"status": 400, "error": "year must be a four-digit year"}),
            json!({"status": 503}),
            json!({"error": "no status"}),
            json!(null),
        ] {
            assert!(!is_pass_refused(&error(data.clone())), "{data}");
        }
        assert!(!is_pass_refused(&answer(
            json!({"status": "error", "errorMessage": "Server Error"})
        )));
        assert!(!is_pass_refused(&answer(
            json!({"status": "success", "value": {"status": 403}})
        )));
    }

    #[test]
    fn pass_answers_grant_the_pass_or_ask_for_a_refresh() {
        assert_eq!(
            read_pass_answer(answer(
                json!({"status": "success", "value": {"pass": "p1", "rotatesAt": 1_800_000_000_000.0}})
            ))
            .unwrap(),
            PassAnswer::Granted(AccessPass {
                pass: "p1".to_owned(),
                rotates_at: 1_800_000_000_000.0
            })
        );
        assert_eq!(
            read_pass_answer(answer(json!({
                "status": "error",
                "errorMessage": "Server Error",
                "errorData": {"status": 403, "error": "subscription required"}
            })))
            .unwrap(),
            PassAnswer::SubscriptionRequired
        );
        for response in [
            json!({"status": "error", "errorMessage": "Server Error", "errorData": {"status": 401, "error": "unauthorized"}}),
            json!({"status": "error", "errorMessage": "Server Error", "errorData": {"status": 503, "error": "no access pass yet"}}),
            json!({"status": "success", "value": {"pass": "", "rotatesAt": 1.0}}),
            json!({"status": "success", "value": {"pass": "p1"}}),
            json!({"status": "success", "value": {"rotatesAt": 1.0}}),
        ] {
            assert!(
                read_pass_answer(answer(response.clone())).is_err(),
                "{response}"
            );
        }
    }

    #[test]
    fn a_pass_is_held_until_it_rotates() {
        let now = 1_000_000_000.0;
        let day = 24.0 * 60.0 * 60.0 * 1000.0;
        assert_eq!(held_until(now + day, now), now + day);
        // A rotation due (by this device's clock) sooner than the minimum
        // hold, or already past, still holds the pass a while.
        assert_eq!(held_until(now - day, now), now + MIN_PASS_HOLD_MS);
        assert_eq!(pass_wait_left(now, now), PASS_WAIT_MS);
        assert_eq!(
            pass_wait_left(now - PASS_WAIT_MS / 2.0, now),
            PASS_WAIT_MS / 2.0
        );
        assert_eq!(pass_wait_left(now - 2.0 * PASS_WAIT_MS, now), 0.0);
        assert_eq!(held_until(now + 1.0, now), now + MIN_PASS_HOLD_MS);

        let held = HeldPass {
            pass: "p1".to_owned(),
            until: now + day,
        };
        assert_eq!(usable_pass(Some(&held), now), Some("p1"));
        assert_eq!(usable_pass(Some(&held), now + day - 1.0), Some("p1"));
        assert_eq!(usable_pass(Some(&held), now + day), None);
        assert_eq!(usable_pass(None, now), None);
    }

    #[test]
    fn a_failed_pass_fetch_is_not_repeated_for_a_while() {
        let now = 1_000_000_000.0;
        assert!(may_fetch(None, now));
        assert!(!may_fetch(Some(now), now));
        assert!(!may_fetch(Some(now - PASS_FETCH_BACKOFF_MS + 1.0), now));
        assert!(may_fetch(Some(now - PASS_FETCH_BACKOFF_MS), now));
    }

    #[test]
    fn entitlement_refreshes_answer_whether_the_entitlement_is_active() {
        for active in [true, false] {
            let response = answer(json!({"status": "success", "value": {"active": active}}));
            assert_eq!(read_entitlement(response).unwrap(), active);
        }
        assert!(read_entitlement(answer(json!({"status": "success", "value": {}}))).is_err());
        assert!(
            read_entitlement(answer(
                json!({"status": "error", "errorMessage": "Unauthenticated"})
            ))
            .is_err()
        );
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
        assert_eq!(error.to_string(), UNREADABLE_MESSAGE);
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
        for value in [
            json!([1, 2]),
            json!({"json": "[]", "isDone": true}),
            json!({"json": "[]", "cursor": "c", "isDone": "yes"}),
            json!({"cursor": "c", "isDone": true}),
            json!({"json": "{}", "cursor": "c", "isDone": true}),
        ] {
            let error = read_page::<u32>(
                queries::CLUB_ATHLETES,
                answer(json!({"status": "success", "value": value})),
            )
            .unwrap_err();
            assert_eq!(error.to_string(), UNREADABLE_MESSAGE, "{value}");
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
        assert_eq!(error.to_string(), TOO_MANY_PAGES_MESSAGE);

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
    fn unreadable_answers_never_name_the_function() {
        let error = read_response::<Vec<u32>>(
            Query::value("reference:standards"),
            answer(json!({"status": "success", "value": {"not": "a list"}})),
        )
        .unwrap_err();
        assert_eq!(error.to_string(), UNREADABLE_MESSAGE);

        let error = read_response::<Vec<u32>>(
            Query::text("reference:records"),
            answer(json!({"status": "success", "value": {"json": "not json"}})),
        )
        .unwrap_err();
        assert_eq!(error.to_string(), UNREADABLE_MESSAGE);

        for message in [UNREADABLE_MESSAGE, TOO_MANY_PAGES_MESSAGE] {
            assert!(!message.contains(':'), "{message}");
        }
    }

    #[test]
    fn a_body_read_cut_off_by_the_timeout_is_a_timeout() {
        // What reqwest's wasm `Response::bytes` reports when the request's
        // timer aborts the body read.
        assert!(body_read_timed_out(
            r#"reqwest::Error { kind: Decode, source: "JsValue(\"reqwest::errors::TimedOut\")" }"#
        ));
        assert!(!body_read_timed_out(
            r#"reqwest::Error { kind: Decode, source: "JsValue(TypeError: network error)" }"#
        ));
    }

    #[test]
    fn requests_that_get_no_answer_explain_themselves_without_the_function() {
        assert_eq!(transport_message(true, false), TIMED_OUT_MESSAGE);
        assert_eq!(transport_message(true, true), TIMED_OUT_MESSAGE);
        assert_eq!(transport_message(false, true), OFFLINE_MESSAGE);
        assert_eq!(transport_message(false, false), UNREACHABLE_MESSAGE);
        for message in [TIMED_OUT_MESSAGE, OFFLINE_MESSAGE, UNREACHABLE_MESSAGE] {
            assert!(!message.contains(':'), "{message}");
        }
        assert_eq!(REQUEST_TIMEOUT, Duration::from_secs(20));
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
