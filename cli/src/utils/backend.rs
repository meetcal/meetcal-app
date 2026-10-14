//! Access to MeetCal's data: the Convex queries in `convex/` at the repository root, the same
//! ones the app and the website read, called over Convex's HTTP API (`POST /api/query`), and the
//! few actions and mutations `meetcal login` and `logout` call.
//!
//! Every request goes through [`send_with_retry`], which uses one shared client and applies the
//! policy in `utils::retry`. A premium query's read carries the access pass (`utils::access`).

use std::sync::OnceLock;
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use reqwest::{Client, Request, Response, StatusCode, header::RETRY_AFTER};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;

use crate::utils::access::{self, Access, Refusal};
use crate::utils::credentials;
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

/// Most pages [`query_all_pages`] reads before giving up. A club's or WSO's entries arrive 2,000
/// rows a page, so this allows 200,000 rows; an answer that never reports `isDone` fails here
/// instead of looping forever.
pub const MAX_PAGES: usize = 100;

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

static ACCESS: OnceLock<Access> = OnceLock::new();

/// The saved login (`utils::credentials::default_path`) and the pass fetched with it, shared by
/// every read of this run.
pub fn default_access() -> &'static Access {
    ACCESS.get_or_init(|| match credentials::default_path() {
        Some(path) => Access::from_file(path),
        None => Access::anonymous(),
    })
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

    /// `GET /meets`: meets starting within three months; takes `now` (milliseconds, rounded
    /// down to the hour so callers share Convex's cached answer).
    pub const UPCOMING_MEETS: Query = Query::text("meets:list");
    /// `GET /meets/completed`: completed meets, newest first.
    pub const COMPLETED_MEETS: Query = Query::text("meets:completed");
    /// `GET /meets/details`; takes `meet`. An unknown meet is a 404 error.
    pub const MEET_DETAILS: Query = Query::text("meets:details");
    /// `GET /meets/schedule`; takes `meet`.
    pub const MEET_SCHEDULE: Query = Query::text("meets:schedule");
    /// Distinct meet names in the results or the registrations, a page at a time; takes `source`
    /// (`results` or `registrations`), `after` (null to start) and optionally `before`. Answers
    /// `{ json, next }`.
    pub const MEET_NAMES_PAGE: Query = Query::value("meets:namesPage");
    /// Lifters with results and entries registered for up to eight meets; takes `meets`.
    /// Answers `{ json }`.
    pub const MEET_ATTENDANCE: Query = Query::value("meets:attendance");
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
    /// `GET /lifting-results/bests`: each name's best snatch, clean & jerk and total since
    /// `cutoffDate`; takes `names` (at most 100) and `cutoffDate`.
    pub const BESTS: Query = Query::value("results:bests");
    /// Every result in a date range, a page at a time; takes `startDate`, `endDate`, `cursor`
    /// (null to start) and `numItems` (at most 2000). Answers `{ json, isDone, continueCursor }`.
    pub const RESULTS_PAGE: Query = Query::value("results:page");
    /// `GET /search`; takes `query`, and optionally `startDate` and `endDate` (both included).
    /// Answers at most 600 results, the most recent, with `truncated` set when it cut some.
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
    /// `GET /clubs`: every club name.
    pub const CLUBS: Query = Query::text("reference:clubs");
    /// `GET /data/wso`: every WSO with records.
    pub const WSO_LIST: Query = Query::text("reference:wsoList");
    /// Every WSO name on registrations: the names `reference:wsoAthletes` matches, which differ
    /// from the record sheets' (`reference:wsoList`).
    pub const REGISTRATION_WSOS: Query = Query::value("reference:registrationWsos");
    /// `GET /data/wso/age-groups`: the age groups a WSO keeps records for; takes `wso`.
    pub const WSO_AGE_GROUPS: Query = Query::text("reference:wsoAgeGroups");
    /// `GET /clubs/athletes`; takes `club`, and `cursor` (null to start) to page. Read it with
    /// [`super::query_all_pages`]: a page answers `{ json, cursor, isDone }`.
    pub const CLUB_ATHLETES: Query = Query::value("reference:clubAthletes");
    /// `GET /clubs/meet-stats`; takes `club` and `meet`.
    pub const CLUB_MEET_STATS: Query = Query::value("reference:clubMeetStats");
    /// `GET /wsos/athletes`; takes `wso`, and `cursor` (null to start) to page. Read it with
    /// [`super::query_all_pages`]: a page answers `{ json, cursor, isDone }`.
    pub const WSO_ATHLETES: Query = Query::value("reference:wsoAthletes");
    /// The access pass for a subscriber, called with the saved login's token as the bearer
    /// (`utils::access`): `{ pass, rotatesAt }`, or status 401 (token not accepted), 403 (no active
    /// subscription) or 503 (no pass yet).
    pub const ACCESS_PASS: Query = Query::value("accessPass:pass");
}

/// The actions and mutations the CLI calls, for `meetcal login` and `logout`
/// (`convex/deviceLogin.ts`, `convex/apiTokens.ts`) and the access pass (`convex/entitlements.ts`).
pub mod functions {
    /// Action. Starts a device login; takes `deviceName` (at most 64 characters). Answers
    /// `{ deviceCode, userCode, verificationUrl, expiresAt, interval }`.
    pub const START_DEVICE_LOGIN: &str = "deviceLogin:start";
    /// Action. Where a device login stands; takes `deviceCode`. Answers `{ status }`, with the
    /// token (`{ token, tokenId, expiresAt }`) once approved.
    pub const POLL_DEVICE_LOGIN: &str = "deviceLogin:poll";
    /// Mutation. Ends the MeetCal-issued token it is called with (as the bearer); takes `{}`.
    pub const REVOKE_TOKEN: &str = "apiTokens:revoke";
    /// Action. Asks RevenueCat for the caller's (the bearer's) subscription and records it;
    /// takes `{}`, answers `{ active }`. Called when `accessPass:pass` answers 403, for a
    /// subscriber Convex does not know yet (a lifetime purchase never sends a renewal).
    pub const REFRESH_ENTITLEMENT: &str = "entitlements:refresh";
}

/// Reads a JSON number as a whole `i64`, whether Convex wrote it as an integer (`5`) or a float
/// (`5.0`, `1791948423574.0`); a fraction is rounded. For every numeric field of an answer the
/// CLI reads outside the data rows (epoch-ms times, intervals).
pub fn whole_number<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<i64, D::Error> {
    let number = f64::deserialize(deserializer)?;
    let rounded = number.round();
    if !rounded.is_finite() || rounded < i64::MIN as f64 || rounded > i64::MAX as f64 {
        return Err(serde::de::Error::custom(format!(
            "{number} is not a whole number"
        )));
    }
    Ok(rounded as i64)
}

/// The kind of Convex function a call runs, which names its HTTP endpoint.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Endpoint {
    Query,
    Mutation,
    Action,
}

impl Endpoint {
    fn path(self) -> &'static str {
        match self {
            Endpoint::Query => "api/query",
            Endpoint::Mutation => "api/mutation",
            Endpoint::Action => "api/action",
        }
    }
}

/// A Convex function that ran and failed: its `errorData` status (our functions throw
/// `{ status, error }`), and the reason. Reaches callers inside `anyhow::Error`; read the status
/// with [`FunctionError::status_of`].
#[derive(Debug)]
pub struct FunctionError {
    pub function: String,
    pub status: Option<u16>,
    pub reason: String,
}

impl std::fmt::Display for FunctionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "MeetCal could not answer {}: {}",
            self.function, self.reason
        )
    }
}

impl std::error::Error for FunctionError {}

impl FunctionError {
    /// The status of the function error `error` carries, if it carries one.
    pub fn status_of(error: &anyhow::Error) -> Option<u16> {
        error
            .chain()
            .find_map(|cause| cause.downcast_ref::<FunctionError>())
            .and_then(|failed| failed.status)
    }
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

impl QueryResponse {
    /// The status a function error carries in its `errorData`, if the answer is one. A value
    /// answer writes its numbers as floats (`403.0`).
    fn function_error_status(&self) -> Option<u16> {
        let QueryResponse::Error {
            error_data: Some(data),
            ..
        } = self
        else {
            return None;
        };
        data.get("status")
            .and_then(Value::as_f64)
            .filter(|status| status.fract() == 0.0 && (0.0..=f64::from(u16::MAX)).contains(status))
            .map(|status| status as u16)
    }
}

/// The arguments of a query that takes none.
#[derive(Serialize)]
pub struct NoArgs {}

/// A paged query's own arguments plus `cursor`: `None` (sent as `null`) asks for the first page.
#[derive(Serialize)]
struct PagedArgs<'a, A: Serialize + ?Sized> {
    #[serde(flatten)]
    args: &'a A,
    cursor: Option<&'a str>,
}

/// One page of a paged query: its rows as JSON text, and where the next page starts.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub json: String,
    pub cursor: String,
    pub is_done: bool,
}

/// Runs `query` with `args` on the production deployment (or `MEETCAL_CONVEX_URL`), with the
/// saved login's access pass when it is a premium read.
pub async fn query<T, A>(query: Query, args: &A) -> Result<T>
where
    T: DeserializeOwned,
    A: Serialize + ?Sized,
{
    query_from(&convex_url(), default_access(), query, args).await
}

/// Runs `query` with `args` on the deployment at `base_url`. A premium read carries the pass
/// `access` holds (see [`premium_answer`]).
pub async fn query_from<T, A>(base_url: &str, access: &Access, query: Query, args: &A) -> Result<T>
where
    T: DeserializeOwned,
    A: Serialize + ?Sized,
{
    let args = serde_json::to_value(args).with_context(|| {
        format!(
            "Failed to build request for MeetCal query {}",
            query.function
        )
    })?;
    let answer = if access::carries_pass(query.function, &args) {
        premium_answer(base_url, access, query.function, &args).await?
    } else {
        call(base_url, Endpoint::Query, query.function, &args, None).await?
    };
    read_answer(query, answer)
}

/// Convex's answer to a premium read. The read carries the pass `access` holds, fetching one first
/// if it has none, and goes without one when it cannot get one. If Convex refuses the read for its
/// pass (status 401 or 403), [`access::on_refusal`] decides: a fresh pass and one more read, or a
/// message telling the user to log in or subscribe.
async fn premium_answer(
    base_url: &str,
    access: &Access,
    function: &str,
    args: &Value,
) -> Result<QueryResponse> {
    let held = access.current_pass(base_url).await;
    let pass = held.pass.as_deref().ok();
    let answer = call(
        base_url,
        Endpoint::Query,
        function,
        &access::with_pass(args, pass),
        None,
    )
    .await?;
    if !access::is_pass_refusal(answer.function_error_status()) {
        return Ok(answer);
    }
    if let Refusal::Fail(message) = access::on_refusal(&held.pass) {
        return Err(PassRefused(message).into());
    }
    let renewed = access.renew_pass(base_url, &held).await;
    let fresh = match renewed.pass {
        Ok(fresh) => fresh,
        Err(reason) => return Err(PassRefused(reason.message()).into()),
    };
    let answer = call(
        base_url,
        Endpoint::Query,
        function,
        &access::with_pass(args, Some(&fresh)),
        None,
    )
    .await?;
    if access::is_pass_refusal(answer.function_error_status()) {
        return Err(PassRefused(format!(
            "MeetCal did not accept the access pass for {function}; try again in a minute, or run \
             `meetcal login` again"
        ))
        .into());
    }
    Ok(answer)
}

/// A premium read Convex refused for want of a current access pass, with what to tell the user.
/// A command that can do without the premium part (`meet`'s past-year bests) checks for it with
/// [`PassRefused::is`].
#[derive(Debug)]
pub struct PassRefused(pub String);

impl std::fmt::Display for PassRefused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for PassRefused {}

impl PassRefused {
    /// Whether `error` is a premium read refused for its pass.
    pub fn is(error: &anyhow::Error) -> bool {
        error
            .chain()
            .any(|cause| cause.downcast_ref::<PassRefused>().is_some())
    }
}

/// Runs the Convex `function` (a query, mutation or action, by `endpoint`) with `args` on the
/// deployment at `base_url`, with `token` as the bearer when given, and parses its value answer.
/// A function that failed is a [`FunctionError`].
pub async fn call_function<T: DeserializeOwned>(
    base_url: &str,
    endpoint: Endpoint,
    function: &str,
    args: &Value,
    token: Option<&str>,
) -> Result<T> {
    let answer = call(base_url, endpoint, function, args, token).await?;
    let value = answer_value(function, answer)?;
    serde_json::from_value(whole_numbers_as_integers(value))
        .with_context(|| format!("Unexpected answer from MeetCal {function}"))
}

/// Posts `function` with `args` to the deployment at `base_url`, with `token` as the bearer when
/// given, and returns Convex's answer.
async fn call(
    base_url: &str,
    endpoint: Endpoint,
    function: &str,
    args: &Value,
    token: Option<&str>,
) -> Result<QueryResponse> {
    let mut builder = client()?
        .post(format!(
            "{}/{}",
            base_url.trim_end_matches('/'),
            endpoint.path()
        ))
        .json(&QueryRequest {
            path: function,
            args,
            format: "json",
        });
    if let Some(token) = token {
        builder = builder.bearer_auth(token);
    }
    let request = builder
        .build()
        .with_context(|| format!("Failed to build request for MeetCal query {function}"))?;

    send_with_retry(request, function)
        .await?
        .json()
        .await
        .with_context(|| format!("Failed to parse MeetCal's answer to {function}"))
}

/// Every row of the paged `query` with `args`, on the production deployment (or
/// `MEETCAL_CONVEX_URL`). See [`query_all_pages_from`].
pub async fn query_all_pages<T, A>(query: Query, args: &A) -> Result<Vec<T>>
where
    T: DeserializeOwned,
    A: Serialize + ?Sized,
{
    query_all_pages_from(&convex_url(), default_access(), query, args).await
}

/// Every row of the paged `query` with `args`, on the deployment at `base_url`: the first call
/// sends `cursor: null`, each later one the cursor the previous page returned, until a page
/// reports `isDone`. Rows come in page order; the server sorts within a page only, and a list
/// replaced while paging can repeat a row, so callers must not rely on order or uniqueness.
pub async fn query_all_pages_from<T, A>(
    base_url: &str,
    access: &Access,
    query: Query,
    args: &A,
) -> Result<Vec<T>>
where
    T: DeserializeOwned,
    A: Serialize + ?Sized,
{
    collect_pages(query.function, |cursor| async move {
        let args = PagedArgs {
            args,
            cursor: cursor.as_deref(),
        };
        query_from::<Page, _>(base_url, access, query, &args).await
    })
    .await
}

/// The paging loop of every paged read, over any page source: `fetch` gets `None` first, then
/// each cursor a page returned, at most [`MAX_PAGES`] times. `function` names the query in
/// errors. A query whose page names its fields differently maps it to a [`Page`].
pub async fn collect_pages<T, F, Fut>(function: &str, mut fetch: F) -> Result<Vec<T>>
where
    T: DeserializeOwned,
    F: FnMut(Option<String>) -> Fut,
    Fut: Future<Output = Result<Page>>,
{
    let mut rows = Vec::new();
    let mut cursor: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let page = fetch(cursor.take()).await?;
        let mut batch: Vec<T> = serde_json::from_str(&page.json)
            .with_context(|| format!("Unexpected answer from MeetCal query {function}"))?;
        rows.append(&mut batch);
        if page.is_done {
            return Ok(rows);
        }
        cursor = Some(page.cursor);
    }
    Err(anyhow!(
        "MeetCal query {function} did not finish within {MAX_PAGES} pages"
    ))
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

/// The value a function answered, or a [`FunctionError`] saying why it has none.
fn answer_value(function: &str, answer: QueryResponse) -> Result<Value> {
    let status = answer.function_error_status();
    match answer {
        QueryResponse::Success { value } => Ok(value),
        QueryResponse::Error {
            error_message,
            error_data,
        } => {
            let reason = error_data
                .as_ref()
                .and_then(|data| data.get("error"))
                .and_then(Value::as_str)
                .unwrap_or(&error_message)
                .to_string();
            Err(FunctionError {
                function: function.to_string(),
                status,
                reason,
            }
            .into())
        }
    }
}

/// The body a query answered, or why it has none.
fn read_answer<T: DeserializeOwned>(query: Query, answer: QueryResponse) -> Result<T> {
    let value = answer_value(query.function, answer)?;
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

    fn page(rows: &[u32], cursor: &str, is_done: bool) -> Page {
        Page {
            json: serde_json::to_string(rows).unwrap(),
            cursor: cursor.to_string(),
            is_done,
        }
    }

    #[test]
    fn paged_requests_add_the_cursor_to_the_arguments() {
        let args = json!({ "club": "Test Barbell" });
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
    fn a_page_is_a_value_answer_carrying_its_rows_as_json_text() {
        let page: Page = read_answer(
            queries::CLUB_ATHLETES,
            answer(json!({"status": "success", "value": {
                "json": "[1,2]", "cursor": "c1", "isDone": false
            }})),
        )
        .unwrap();
        assert_eq!(page.json, "[1,2]");
        assert_eq!(page.cursor, "c1");
        assert!(!page.is_done);

        for value in [
            json!([1, 2]),
            json!({"json": "[]", "isDone": true}),
            json!({"json": "[]", "cursor": "c", "isDone": "yes"}),
            json!({"json": [], "cursor": "c", "isDone": true}),
        ] {
            let error = read_answer::<Page>(
                queries::WSO_ATHLETES,
                answer(json!({"status": "success", "value": value})),
            )
            .unwrap_err();
            assert_eq!(
                error.to_string(),
                "Unexpected answer from MeetCal query reference:wsoAthletes"
            );
        }
    }

    #[tokio::test]
    async fn pages_are_read_from_a_null_cursor_until_one_is_done() {
        let mut pages = vec![
            page(&[3], "c1", false),
            page(&[], "c2", false),
            page(&[2, 1], "c3", true),
        ]
        .into_iter();
        let mut cursors = Vec::new();
        let rows: Vec<u32> = collect_pages("test:paged", |cursor| {
            cursors.push(cursor);
            let next = pages.next().expect("no more pages");
            async move { Ok(next) }
        })
        .await
        .unwrap();
        assert_eq!(rows, [3, 2, 1]);
        assert_eq!(
            cursors,
            [None, Some("c1".to_string()), Some("c2".to_string())]
        );
    }

    #[tokio::test]
    async fn paging_stops_at_the_page_limit() {
        let mut calls = 0;
        let error = collect_pages::<u32, _, _>("test:paged", |_| {
            calls += 1;
            let next = page(&[calls], &format!("c{calls}"), false);
            async move { Ok(next) }
        })
        .await
        .unwrap_err();
        assert_eq!(calls as usize, MAX_PAGES);
        assert_eq!(
            error.to_string(),
            format!("MeetCal query test:paged did not finish within {MAX_PAGES} pages")
        );

        let mut calls = 0;
        let rows: Vec<u32> = collect_pages("test:paged", |_| {
            calls += 1;
            let next = page(&[calls], "c", calls as usize == MAX_PAGES);
            async move { Ok(next) }
        })
        .await
        .unwrap();
        assert_eq!(rows.len(), MAX_PAGES);
    }

    #[tokio::test]
    async fn a_malformed_or_failed_page_fails_the_whole_read() {
        let mut pages = vec![
            page(&[1], "c1", false),
            Page {
                json: "{}".to_string(),
                cursor: "c2".to_string(),
                is_done: true,
            },
        ]
        .into_iter();
        let error = collect_pages::<u32, _, _>("test:paged", |_| {
            let next = pages.next().expect("no more pages");
            async move { Ok(next) }
        })
        .await
        .unwrap_err();
        assert_eq!(
            error.to_string(),
            "Unexpected answer from MeetCal query test:paged"
        );

        let mut calls = 0;
        let error = collect_pages::<u32, _, _>("test:paged", |_| {
            calls += 1;
            let result = if calls == 1 {
                Ok(page(&[1], "c1", false))
            } else {
                Err(anyhow!("MeetCal could not answer test:paged: boom"))
            };
            async move { result }
        })
        .await
        .unwrap_err();
        assert_eq!(calls, 2);
        assert_eq!(
            error.to_string(),
            "MeetCal could not answer test:paged: boom"
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
    fn function_errors_carry_their_status() {
        let failed = |data: Value| {
            answer(json!({"status": "error", "errorMessage": "Server Error", "errorData": data}))
        };
        for (data, status) in [
            (
                json!({"status": 401, "error": "access pass required"}),
                Some(401),
            ),
            (
                json!({"status": 403.0, "error": "access pass expired"}),
                Some(403),
            ),
            (json!({"status": "403"}), None),
            (json!({"status": 403.5}), None),
            (json!({"error": "no status"}), None),
        ] {
            let answer = failed(data.clone());
            assert_eq!(answer.function_error_status(), status, "{data}");
            let error = answer_value("test:fn", answer).unwrap_err();
            assert_eq!(FunctionError::status_of(&error), status, "{data}");
        }
        let success = answer(json!({"status": "success", "value": {"status": 403}}));
        assert_eq!(success.function_error_status(), None);
        assert_eq!(
            FunctionError::status_of(&anyhow!("not a function error")),
            None
        );
    }

    #[test]
    fn whole_numbers_read_integers_and_floats() {
        #[derive(Deserialize)]
        struct Times {
            #[serde(deserialize_with = "whole_number")]
            at: i64,
        }
        for (value, expected) in [
            (json!(5), 5),
            (json!(5.0), 5),
            (json!(1_791_948_423_574_i64), 1_791_948_423_574),
            (json!(1_791_948_423_574.0), 1_791_948_423_574),
            (json!(1_791_948_423_574.4), 1_791_948_423_574),
            (json!(-3.0), -3),
        ] {
            let times: Times = serde_json::from_value(json!({ "at": value })).unwrap();
            assert_eq!(times.at, expected, "{value}");
        }
        for value in [json!("5"), json!(null), json!(1e300)] {
            assert!(
                serde_json::from_value::<Times>(json!({ "at": value })).is_err(),
                "{value}"
            );
        }
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
