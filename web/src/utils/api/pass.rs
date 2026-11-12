use super::*;
use anyhow::{Result, anyhow};
use futures::future::{FutureExt, LocalBoxFuture, Shared};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::{cell::RefCell, time::Duration};

pub(super) const ACCESS_PASS: &str = "accessPass:pass";

pub(super) const PASS_ARGUMENT: &str = "pass";

pub(super) const REFRESH_ENTITLEMENT: &str = "entitlements:refresh";

pub(super) const MIN_PASS_HOLD_MS: f64 = 5.0 * 60.0 * 1000.0;

pub(super) const PASS_WAIT_MS: f64 = 3000.0;

pub(super) const REFUSED_READ_PASS_WAIT_MS: f64 = 15.0 * 1000.0;

pub(super) const PASS_FETCH_BACKOFF_MS: f64 = 60.0 * 1000.0;

pub(super) async fn send_with_pass(
    endpoint: Endpoint,
    function: &str,
    args: &Value,
    timeout: Duration,
) -> Result<QueryResponse> {
    let pass = current_pass().await;
    let response = post_within(
        endpoint,
        function,
        &with_pass(args, pass.as_deref()),
        None,
        timeout,
    )
    .await?;
    if !is_pass_refused(&response) {
        return Ok(response);
    }
    let Some(fresh) = renewed_pass(pass.as_deref()).await else {
        return Ok(response);
    };
    leptos::logging::warn!(
        "Convex refused the access pass for {function}; reading again with a fresh one"
    );
    post_within(
        endpoint,
        function,
        &with_pass(args, Some(&fresh)),
        None,
        timeout,
    )
    .await
}

pub(super) fn with_pass(args: &Value, pass: Option<&str>) -> Value {
    let mut args = args.clone();
    if let (Some(pass), Some(fields)) = (pass, args.as_object_mut()) {
        fields.insert(PASS_ARGUMENT.to_owned(), Value::from(pass));
    }
    args
}

pub(super) fn is_pass_refused(response: &QueryResponse) -> bool {
    matches!(function_error_status(response), Some(401 | 403))
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AccessPass {
    pub(super) pass: String,
    pub(super) rotates_at: f64,
}

#[derive(Debug, PartialEq)]
pub(super) enum PassAnswer {
    Granted(AccessPass),
    SubscriptionRequired,
}

pub(super) fn read_pass_answer(response: QueryResponse) -> Result<PassAnswer> {
    if function_error_status(&response) == Some(403) {
        return Ok(PassAnswer::SubscriptionRequired);
    }
    let pass: AccessPass = serde_json::from_value(answer_value(response)?)?;
    if pass.pass.is_empty() || !pass.rotates_at.is_finite() {
        return Err(anyhow!("malformed access pass"));
    }
    Ok(PassAnswer::Granted(pass))
}

pub(super) async fn request_access_pass(token: &str) -> Result<PassAnswer> {
    let response = post(
        Endpoint::Query,
        ACCESS_PASS,
        &Value::Object(Map::new()),
        Some(token),
    )
    .await?;
    read_pass_answer(response)
}

pub(super) async fn refresh_entitlement(token: &str) -> Result<bool> {
    let response = post(
        Endpoint::Action,
        REFRESH_ENTITLEMENT,
        &Value::Object(Map::new()),
        Some(token),
    )
    .await?;
    read_entitlement(response)
}

pub(super) fn read_entitlement(response: QueryResponse) -> Result<bool> {
    answer_value(response)?
        .get("active")
        .and_then(Value::as_bool)
        .ok_or_else(|| anyhow!("answer has no active flag"))
}

pub(super) async fn fetch_access_pass() -> Option<AccessPass> {
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

#[derive(Clone, Debug, PartialEq)]
pub(super) struct HeldPass {
    pub(super) pass: String,
    pub(super) until: f64,
}

pub(super) type PassFetch = Shared<LocalBoxFuture<'static, Option<String>>>;

#[derive(Default)]
pub(super) struct PassState {
    pub(super) held: Option<HeldPass>,
    pub(super) failed_at: Option<f64>,
    pub(super) fetching: Option<(PassFetch, f64)>,
    pub(super) generation: u64,
}

thread_local! {
    static ACCESS_PASS_STATE: RefCell<PassState> = RefCell::new(PassState::default());
}

pub(super) fn held_until(rotates_at: f64, now: f64) -> f64 {
    rotates_at.max(now + MIN_PASS_HOLD_MS)
}

pub(super) fn usable_pass(held: Option<&HeldPass>, now: f64) -> Option<&str> {
    held.filter(|held| now < held.until)
        .map(|held| held.pass.as_str())
}

pub(super) fn may_fetch(failed_at: Option<f64>, now: f64) -> bool {
    failed_at.is_none_or(|failed_at| now - failed_at >= PASS_FETCH_BACKOFF_MS)
}

pub(super) enum PassStep {
    Use(String),
    Join(PassFetch, f64),
    Fetch,
    GoWithout,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum PassWaiter {
    FirstRead,
    ReadConvexRefused,
}

pub(super) fn pass_wait_left(waiter: PassWaiter, fetch_started_at: f64, now: f64) -> f64 {
    match waiter {
        PassWaiter::FirstRead => (fetch_started_at + PASS_WAIT_MS - now).max(0.0),
        PassWaiter::ReadConvexRefused => REFUSED_READ_PASS_WAIT_MS,
    }
}

pub(super) async fn wait_for_pass(
    waiter: PassWaiter,
    fetch: PassFetch,
    fetch_started_at: f64,
) -> Option<String> {
    let left = pass_wait_left(waiter, fetch_started_at, js_sys::Date::now());
    if left <= 0.0 {
        return None;
    }
    let timer = sleep(Duration::from_millis(left as u64));
    match futures::future::select(Box::pin(fetch), Box::pin(timer)).await {
        futures::future::Either::Left((pass, _)) => pass,
        futures::future::Either::Right(_) => None,
    }
}

pub(super) async fn current_pass() -> Option<String> {
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
        PassStep::Join(fetch, started_at) => {
            wait_for_pass(PassWaiter::FirstRead, fetch, started_at).await
        }
        PassStep::Fetch => {
            let (fetch, started_at) = start_pass_fetch();
            wait_for_pass(PassWaiter::FirstRead, fetch, started_at).await
        }
        PassStep::GoWithout => None,
    }
}

pub(super) async fn renewed_pass(refused: Option<&str>) -> Option<String> {
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
        PassStep::Join(fetch, started_at) => {
            wait_for_pass(PassWaiter::ReadConvexRefused, fetch, started_at).await
        }
        PassStep::Fetch | PassStep::GoWithout => {
            let (fetch, started_at) = start_pass_fetch();
            wait_for_pass(PassWaiter::ReadConvexRefused, fetch, started_at).await
        }
    }
}

pub(super) fn start_pass_fetch() -> (PassFetch, f64) {
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

pub(crate) fn forget_access_pass() {
    ACCESS_PASS_STATE.with_borrow_mut(|state| {
        *state = PassState {
            generation: state.generation + 1,
            ..PassState::default()
        };
    });
}
