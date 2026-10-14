//! The access pass premium reads carry (`../docs/backend.md`, "Premium data").
//!
//! The premium queries ([`PREMIUM_FUNCTIONS`]) and actions ([`PREMIUM_ACTIONS`]) take a shared
//! daily pass as their `pass` argument.
//! A user who ran `meetcal login` has a MeetCal-issued token (`utils::credentials`); before the
//! first premium read the CLI trades it for the pass with `accessPass:pass`, once per process, and
//! adds the pass to every premium read. The token itself goes to no data read, so premium answers
//! stay in Convex's shared cache. Without a pass (not logged in, not subscribed, an expired login)
//! a premium read goes out without one: while Convex only logs such reads it still answers them.
//! Once it refuses them (a function error with status 401 or 403), [`on_refusal`] decides whether
//! a fresh pass is worth one more try or the user must log in or subscribe.

use std::path::PathBuf;

use serde::Deserialize;
use serde_json::Value;
use tokio::sync::Mutex;

use crate::utils::backend::{self, Endpoint, FunctionError, functions, queries};
use crate::utils::credentials::{self, Credentials};

/// The Convex functions that answer premium data and take the access pass in their `pass`
/// argument. The list is Convex's (`PREMIUM_FUNCTIONS` in `convex/lib/access.ts`) and the
/// website's (`SUBSCRIPTION_FUNCTIONS` in `web/src/utils/api.rs`), including functions the CLI
/// does not call, so a command that starts calling one sends the pass without another change.
/// `results:search` needs it only with both dates ([`carries_pass`]): name suggestions are public.
pub const PREMIUM_FUNCTIONS: &[&str] = &[
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

/// The Convex actions that answer premium data, apart from [`PREMIUM_FUNCTIONS`] (queries only):
/// Convex's `PREMIUM_ACTIONS` (`convex/lib/access.ts`). An action reads them with the pass the same
/// way (`backend::premium_action`), and a refusal is handled as a premium query's.
pub const PREMIUM_ACTIONS: &[&str] = &["results:leaderboard"];

/// The argument a premium query takes the access pass in.
pub const PASS_ARGUMENT: &str = "pass";

/// The query whose pass depends on its arguments, and the arguments that make it premium.
const SEARCH_FUNCTION: &str = "results:search";
const SEARCH_DATE_ARGUMENTS: [&str; 2] = ["startDate", "endDate"];

/// What to tell a user whose premium read was refused and who has not logged in.
pub const LOGIN_NEEDED: &str = "This command reads MeetCal subscriber data. Run `meetcal login` to sign in \
     (a MeetCal subscription is needed), then try again.";

/// Whether `function` answers premium data.
pub fn is_premium(function: &str) -> bool {
    PREMIUM_FUNCTIONS.contains(&function)
}

/// Whether `function`, sent with `args`, takes the access pass: a premium function, except a
/// search without both dates (a name suggestion, which is public).
pub fn carries_pass(function: &str, args: &Value) -> bool {
    is_premium(function)
        && (function != SEARCH_FUNCTION
            || SEARCH_DATE_ARGUMENTS
                .iter()
                .all(|name| args.get(name).is_some_and(|value| !value.is_null())))
}

/// `args` with the access pass added as `pass`; unchanged without a pass.
pub fn with_pass(args: &Value, pass: Option<&str>) -> Value {
    let mut args = args.clone();
    if let (Some(pass), Some(fields)) = (pass, args.as_object_mut()) {
        fields.insert(PASS_ARGUMENT.to_owned(), Value::from(pass));
    }
    args
}

/// Whether a function error status means Convex refused a premium read for its pass: 401 without
/// one, 403 with one it no longer accepts.
pub fn is_pass_refusal(status: Option<u16>) -> bool {
    matches!(status, Some(401 | 403))
}

/// Why a premium read has no pass.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NoPass {
    /// No saved login (for this deployment).
    LoggedOut,
    /// The saved login's token has expired.
    LoginExpired,
    /// `accessPass:pass` refused the token (401): revoked, or from a replaced signing key.
    LoginRejected,
    /// `accessPass:pass` answered 403: the account has no active subscription.
    NotSubscribed,
    /// The saved login could not be read.
    UnreadableLogin(String),
    /// The pass could not be fetched (no pass yet, a network failure, an odd answer).
    Unavailable(String),
}

impl NoPass {
    /// What to tell the user when a premium read fails for want of a pass.
    pub fn message(&self) -> String {
        match self {
            NoPass::LoggedOut => LOGIN_NEEDED.to_string(),
            NoPass::LoginExpired => {
                "Your MeetCal login has expired. Run `meetcal login` to sign in again.".to_string()
            }
            NoPass::LoginRejected => "MeetCal no longer accepts this computer's login. Run \
                                      `meetcal login` to sign in again."
                .to_string(),
            NoPass::NotSubscribed => "A MeetCal subscription is needed for this command. \
                                      Subscribe in the MeetCal app, then try again."
                .to_string(),
            NoPass::UnreadableLogin(reason) => {
                format!("{reason}. Run `meetcal login` to sign in again.")
            }
            NoPass::Unavailable(reason) => {
                format!("Could not get MeetCal's access pass ({reason}); try again in a minute.")
            }
        }
    }
}

/// What a premium read does after Convex refused it for its pass.
#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    /// Fetch a fresh pass and read once more.
    Renew,
    /// Give up with this message.
    Fail(String),
}

/// The decision after a refused premium read that was sent with `pass` (the pass, or why there
/// was none). A refused pass may have rotated, and a failed fetch may have been a network blip,
/// so both renew once; a missing, expired or rejected login, or no subscription, will not change
/// within this run.
pub fn on_refusal(pass: &Result<String, NoPass>) -> Refusal {
    match pass {
        Ok(_) | Err(NoPass::Unavailable(_)) => Refusal::Renew,
        Err(reason) => Refusal::Fail(reason.message()),
    }
}

/// `accessPass:pass`'s answer.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessPass {
    pub pass: String,
    /// When to ask again (epoch ms). A process lives far shorter than a pass, so the CLI fetches
    /// once per run and does not read this.
    #[allow(dead_code)]
    #[serde(deserialize_with = "backend::whole_number")]
    pub rotates_at: i64,
}

/// `entitlements:refresh`'s answer.
#[derive(Debug, Deserialize)]
pub struct Refreshed {
    pub active: bool,
}

/// The pass for `token` from the deployment at `base_url`, or why there is none. When
/// `accessPass:pass` answers 403, asks `entitlements:refresh` to re-check the subscription with
/// RevenueCat (a purchase Convex has not heard of yet, or a lifetime one) and, if it is active,
/// asks for the pass once more. A refresh that fails or says inactive leaves it at 403.
pub async fn fetch_pass(base_url: &str, token: &str) -> Result<String, NoPass> {
    match ask_pass(base_url, token).await {
        Err(NoPass::NotSubscribed) if refreshed_active(base_url, token).await => {
            ask_pass(base_url, token).await
        }
        outcome => outcome,
    }
}

/// Whether `entitlements:refresh` says the bearer of `token` subscribes.
async fn refreshed_active(base_url: &str, token: &str) -> bool {
    backend::call_function::<Refreshed>(
        base_url,
        Endpoint::Action,
        functions::REFRESH_ENTITLEMENT,
        &serde_json::json!({}),
        Some(token),
    )
    .await
    .is_ok_and(|refreshed| refreshed.active)
}

/// One `accessPass:pass` call with `token`.
async fn ask_pass(base_url: &str, token: &str) -> Result<String, NoPass> {
    match backend::call_function::<AccessPass>(
        base_url,
        Endpoint::Query,
        queries::ACCESS_PASS.function,
        &serde_json::json!({}),
        Some(token),
    )
    .await
    {
        Ok(answer) => Ok(answer.pass),
        Err(error) => Err(match FunctionError::status_of(&error) {
            Some(401) => NoPass::LoginRejected,
            Some(403) => NoPass::NotSubscribed,
            _ => NoPass::Unavailable(format!("{error:#}")),
        }),
    }
}

/// Where the saved login comes from.
#[derive(Debug)]
enum LoginSource {
    /// Never logged in (no home directory, or a test).
    None,
    File(PathBuf),
}

/// The pass held for this run, and how many times it has been fetched.
#[derive(Debug, Default)]
struct PassState {
    generation: u64,
    outcome: Option<Result<String, NoPass>>,
}

/// A pass as a read saw it: the pass (or why there is none) and the fetch it came from.
#[derive(Clone, Debug)]
pub struct HeldPass {
    pub pass: Result<String, NoPass>,
    generation: u64,
}

/// The saved login and the pass fetched with it, for one run. Concurrent reads share one fetch.
#[derive(Debug)]
pub struct Access {
    source: LoginSource,
    state: Mutex<PassState>,
}

impl Access {
    /// Access with no login: premium reads go without a pass.
    pub fn anonymous() -> Self {
        Self::with_source(LoginSource::None)
    }

    /// Access with the login saved at `path`.
    pub fn from_file(path: PathBuf) -> Self {
        Self::with_source(LoginSource::File(path))
    }

    fn with_source(source: LoginSource) -> Self {
        Self {
            source,
            state: Mutex::new(PassState::default()),
        }
    }

    /// The pass for reads from the deployment at `base_url`, fetched by the first read.
    pub async fn current_pass(&self, base_url: &str) -> HeldPass {
        let mut state = self.state.lock().await;
        if state.outcome.is_none() {
            let outcome = self.fetch(base_url).await;
            note_login_problem(&outcome);
            state.generation += 1;
            state.outcome = Some(outcome);
        }
        held(&state)
    }

    /// A fresh pass after Convex refused a read sent with `refused`. A pass fetched since that
    /// read (another read renewed it) is used as it is.
    pub async fn renew_pass(&self, base_url: &str, refused: &HeldPass) -> HeldPass {
        let mut state = self.state.lock().await;
        if state.generation == refused.generation {
            state.outcome = Some(self.fetch(base_url).await);
            state.generation += 1;
        }
        held(&state)
    }

    async fn fetch(&self, base_url: &str) -> Result<String, NoPass> {
        let login = match &self.source {
            LoginSource::None => return Err(NoPass::LoggedOut),
            LoginSource::File(path) => login_for(credentials::load(path), base_url, now_ms())?,
        };
        fetch_pass(base_url, &login.token).await
    }
}

fn held(state: &PassState) -> HeldPass {
    HeldPass {
        pass: state.outcome.clone().unwrap_or(Err(NoPass::LoggedOut)),
        generation: state.generation,
    }
}

/// The saved login usable on `base_url` at `now_ms`, or why there is none.
pub fn login_for(
    saved: anyhow::Result<Option<Credentials>>,
    base_url: &str,
    now_ms: i64,
) -> Result<Credentials, NoPass> {
    match saved {
        Err(error) => Err(NoPass::UnreadableLogin(format!("{error:#}"))),
        Ok(None) => Err(NoPass::LoggedOut),
        Ok(Some(login)) if !login.is_for(base_url) => Err(NoPass::LoggedOut),
        Ok(Some(login)) if login.is_expired(now_ms) => Err(NoPass::LoginExpired),
        Ok(Some(login)) => Ok(login),
    }
}

/// Tells a user who logged in that the login no longer works, once per run, on stderr. Reads go
/// on without the pass while Convex answers them.
fn note_login_problem(outcome: &Result<String, NoPass>) {
    if let Err(
        reason @ (NoPass::LoginExpired | NoPass::LoginRejected | NoPass::UnreadableLogin(_)),
    ) = outcome
    {
        eprintln!("Note: {}", reason.message());
    }
}

/// The time now, in epoch milliseconds.
pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_premium_functions_match_the_servers_list() {
        assert_eq!(PREMIUM_FUNCTIONS.len(), 23);
        assert!(!is_premium(queries::ACCESS_PASS.function));
        for public in [
            "meets:list",
            "meets:completed",
            "meets:details",
            "meets:schedule",
            "meets:namesPage",
            "meets:attendance",
            "meets:athletes",
            "meets:athletesSessions",
            queries::WRAPPED.function,
        ] {
            assert!(!is_premium(public), "{public}");
        }
        assert!(is_premium("results:page"));
        for premium in [
            queries::RECORDS,
            queries::CLUB_ATHLETES,
            queries::MEET_RESULTS,
            queries::BESTS,
            queries::SEARCH,
        ] {
            assert!(is_premium(premium.function), "{}", premium.function);
        }
    }

    #[test]
    fn the_list_is_a_plain_array_literal_the_servers_test_can_read() {
        let source = include_str!("access.rs");
        let start = source
            .find("pub const PREMIUM_FUNCTIONS: &[&str] = &[")
            .expect("the list's declaration");
        let body = &source[start..];
        let body = &body[body.find("&[\n").unwrap() + 3..body.find("];").unwrap()];
        let names: Vec<&str> = body
            .lines()
            .map(|line| line.trim().trim_end_matches(',').trim_matches('"'))
            .filter(|line| !line.is_empty())
            .collect();
        assert_eq!(names, PREMIUM_FUNCTIONS);
    }

    #[test]
    fn the_premium_actions_are_apart_from_the_queries() {
        assert_eq!(PREMIUM_ACTIONS, [functions::LEADERBOARD]);
        for action in PREMIUM_ACTIONS {
            assert!(!is_premium(action), "{action}");
        }
    }

    #[test]
    fn only_a_dated_search_carries_the_pass() {
        let dated = json!({"query": "Smith", "startDate": "2026-01-01", "endDate": "2026-12-31"});
        assert!(carries_pass("results:search", &dated));
        for suggestion in [
            json!({"query": "Smi"}),
            json!({"query": "Smi", "startDate": "2026-01-01"}),
            json!({"query": "Smi", "endDate": "2026-12-31"}),
            json!({"query": "Smi", "startDate": null, "endDate": null}),
        ] {
            assert!(!carries_pass("results:search", &suggestion), "{suggestion}");
        }
        assert!(carries_pass("results:byMeet", &json!({"meet": "M"})));
        assert!(!carries_pass("meets:schedule", &json!({"meet": "M"})));
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
    fn only_401_and_403_refuse_the_pass() {
        assert!(is_pass_refusal(Some(401)));
        assert!(is_pass_refusal(Some(403)));
        for status in [None, Some(400), Some(404), Some(429), Some(503)] {
            assert!(!is_pass_refusal(status), "{status:?}");
        }
    }

    #[test]
    fn a_refused_read_renews_only_when_a_new_pass_could_help() {
        assert_eq!(on_refusal(&Ok("p1".to_string())), Refusal::Renew);
        assert_eq!(
            on_refusal(&Err(NoPass::Unavailable("timed out".to_string()))),
            Refusal::Renew
        );
        assert_eq!(
            on_refusal(&Err(NoPass::LoggedOut)),
            Refusal::Fail(LOGIN_NEEDED.to_string())
        );
        for (reason, says) in [
            (NoPass::LoginExpired, "has expired"),
            (NoPass::LoginRejected, "no longer accepts"),
            (NoPass::NotSubscribed, "subscription is needed"),
            (NoPass::UnreadableLogin("bad file".to_string()), "bad file"),
        ] {
            match on_refusal(&Err(reason.clone())) {
                Refusal::Fail(message) => {
                    assert!(message.contains(says), "{reason:?}: {message}");
                    assert!(
                        reason == NoPass::NotSubscribed || message.contains("meetcal login"),
                        "{message}"
                    );
                }
                Refusal::Renew => panic!("{reason:?} renewed"),
            }
        }
    }

    fn saved(expires_at: i64, deployment: &str) -> Credentials {
        Credentials {
            token: "t".to_string(),
            token_id: "tid".to_string(),
            expires_at,
            deployment: deployment.to_string(),
        }
    }

    #[test]
    fn a_login_is_used_only_on_its_deployment_until_it_expires() {
        let base = "https://a.convex.cloud";
        assert_eq!(
            login_for(Ok(Some(saved(2_000, base))), base, 1_000),
            Ok(saved(2_000, base))
        );
        assert_eq!(
            login_for(Ok(Some(saved(2_000, base))), base, 2_000),
            Err(NoPass::LoginExpired)
        );
        assert_eq!(
            login_for(
                Ok(Some(saved(2_000, base))),
                "https://b.convex.cloud",
                1_000
            ),
            Err(NoPass::LoggedOut)
        );
        assert_eq!(login_for(Ok(None), base, 1_000), Err(NoPass::LoggedOut));
        assert!(matches!(
            login_for(Err(anyhow::anyhow!("broken")), base, 1_000),
            Err(NoPass::UnreadableLogin(reason)) if reason == "broken"
        ));
    }

    #[tokio::test]
    async fn anonymous_access_never_has_a_pass() {
        let access = Access::anonymous();
        let held = access.current_pass("http://127.0.0.1:9").await;
        assert_eq!(held.pass, Err(NoPass::LoggedOut));
        let renewed = access.renew_pass("http://127.0.0.1:9", &held).await;
        assert_eq!(renewed.pass, Err(NoPass::LoggedOut));
    }
}
