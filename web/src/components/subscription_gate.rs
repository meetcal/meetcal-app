use crate::{
    auth::{AuthContext, AuthState, has_comp_data_access, mount_sign_in, unmount_sign_in},
    components::store_links::{APP_STORE_URL, PLAY_STORE_URL},
};
use leptos::prelude::*;

/// How long a granted subscription is trusted before a data page checks it
/// again (in the background, keeping the page).
const ACCESS_RECHECK_AFTER_MS: f64 = 10.0 * 60.0 * 1000.0;

#[derive(Clone, Debug, PartialEq, Eq)]
enum AccessState {
    /// Signed in, and not checked: no data page has opened since the user
    /// signed in. The first gate to open checks.
    Unchecked,
    Checking,
    SignedOut,
    Paid,
    Unpaid,
    Error(String),
}

/// The signed-in user's access to the data pages, shared by every route's
/// gate, so moving between data pages neither re-checks it nor rebuilds the
/// page. It is checked only while a data page is open: when the user changes,
/// when a page opens after a failed or unpaid answer, in the background once
/// a granted answer is older than `ACCESS_RECHECK_AFTER_MS`, and in the
/// background when the tab is shown again over an unpaid answer (the user
/// may have subscribed in the app meanwhile). Public pages never check.
#[derive(Clone, Copy)]
pub struct AccessContext {
    auth: AuthContext,
    state: RwSignal<AccessState>,
    /// The user and time (ms) of the last finished check.
    checked: StoredValue<Option<(String, f64)>>,
    /// Numbers checks, so only the newest may publish its answer.
    latest_check: StoredValue<u64>,
    /// Gates mounted now (more than one while a route change swaps them).
    open_gates: StoredValue<usize>,
}

/// Provides the shared access state; call once, after `provide_auth`.
pub fn provide_access() {
    let auth = expect_context::<AuthContext>();
    let access = AccessContext {
        auth,
        state: RwSignal::new(AccessState::Checking),
        checked: StoredValue::new(None),
        latest_check: StoredValue::new(0),
        open_gates: StoredValue::new(0),
    };
    provide_context(access);

    // `auth.state` changes only when the user does (see `provide_auth`).
    Effect::new(move |_| match auth.state.get() {
        AuthState::Loading => access.show(AccessState::Checking),
        AuthState::SignedOut => {
            access.checked.set_value(None);
            access.show(AccessState::SignedOut);
        }
        AuthState::ConfigurationError(message) => access.show(AccessState::Error(message)),
        AuthState::SignedIn(user_id) if access.gate_open() => access.check(user_id, true),
        AuthState::SignedIn(_) => access.forget(),
    });

    // Clerk does not report the same user again (see `provide_auth`), so an
    // unpaid user back from subscribing in the app is checked on return.
    // Dropping the handle keeps the listener, for as long as the app runs.
    let _ = window_event_listener(leptos::ev::visibilitychange, move |_| {
        access.recheck_unpaid();
    });
}

impl AccessContext {
    fn gate_open(&self) -> bool {
        self.open_gates.try_get_value().is_some_and(|open| open > 0)
    }

    /// Drops any check and answer for a user no data page is showing; the
    /// next gate to open checks.
    fn forget(self) {
        self.latest_check.update_value(|latest| *latest += 1);
        self.checked.set_value(None);
        self.show(AccessState::Unchecked);
    }

    /// The tab was shown again: check an unpaid answer in the background,
    /// keeping the page unless access is granted.
    fn recheck_unpaid(self) {
        let visible = web_sys::window()
            .and_then(|window| window.document())
            .is_some_and(|document| !document.hidden());
        if !visible || !self.gate_open() || self.state.get_untracked() != AccessState::Unpaid {
            return;
        }
        if let AuthState::SignedIn(user_id) = self.auth.state.get_untracked() {
            self.check(user_id, false);
        }
    }

    /// Shows `next`, notifying only on a change: the gate rebuilds its page
    /// for every notification.
    fn show(&self, next: AccessState) {
        if self.state.get_untracked() != next {
            self.state.set(next);
        }
    }

    /// Checks `user_id`'s entitlement; `show_checking` replaces the page with
    /// the checking card meanwhile.
    fn check(self, user_id: String, show_checking: bool) {
        let Some(check) = self.latest_check.try_update_value(|latest| {
            *latest += 1;
            *latest
        }) else {
            return;
        };
        if show_checking {
            self.show(AccessState::Checking);
        }
        // A background check counts as recent from its start, so pages opened
        // while it runs don't start more; if it fails, the previous time is
        // restored and the next page opened tries again.
        let previous = self.checked.get_value();
        if !show_checking {
            self.checked
                .set_value(Some((user_id.clone(), js_sys::Date::now())));
        }
        leptos::task::spawn_local(async move {
            let result = has_comp_data_access(&user_id).await;
            let is_latest = self
                .latest_check
                .try_with_value(|latest| *latest == check)
                .unwrap_or(false);
            if !is_latest || self.auth.state.get_untracked() != AuthState::SignedIn(user_id.clone())
            {
                return;
            }
            if !show_checking && result.is_err() {
                // A failed background check keeps the page the user is on.
                self.checked.set_value(previous);
                return;
            }
            self.checked.set_value(Some((user_id, js_sys::Date::now())));
            self.show(access_for(result));
        });
    }

    /// A data page opened: check again unless a check is running or the user
    /// was granted access recently.
    fn refresh(self) {
        let AuthState::SignedIn(user_id) = self.auth.state.get_untracked() else {
            return;
        };
        let checked_at = self.checked.with_value(|checked| {
            checked
                .as_ref()
                .filter(|(checked_user, _)| *checked_user == user_id)
                .map(|(_, at)| *at)
        });
        match recheck_on_open(&self.state.get_untracked(), checked_at, js_sys::Date::now()) {
            Recheck::No => {}
            Recheck::InBackground => self.check(user_id, false),
            Recheck::Showing => self.check(user_id, true),
        }
    }

    /// The error card's Try again: check again, or reload when the page
    /// itself could not set up sign-in.
    fn retry(self) {
        match self.auth.state.get_untracked() {
            AuthState::SignedIn(user_id) => self.check(user_id, true),
            _ => {
                if let Some(window) = web_sys::window() {
                    let _ = window.location().reload();
                }
            }
        }
    }
}

fn access_for(result: Result<bool, String>) -> AccessState {
    match result {
        Ok(true) => AccessState::Paid,
        Ok(false) => AccessState::Unpaid,
        Err(message) => AccessState::Error(message),
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Recheck {
    No,
    InBackground,
    Showing,
}

/// Whether a data page opening should check access again, given the shown
/// state and when the signed-in user's last check finished.
fn recheck_on_open(state: &AccessState, checked_at: Option<f64>, now: f64) -> Recheck {
    match state {
        AccessState::Checking => Recheck::No,
        AccessState::Paid => match checked_at {
            Some(at) if now - at < ACCESS_RECHECK_AFTER_MS => Recheck::No,
            _ => Recheck::InBackground,
        },
        AccessState::Unchecked
        | AccessState::SignedOut
        | AccessState::Unpaid
        | AccessState::Error(_) => Recheck::Showing,
    }
}

#[component]
pub fn SubscriptionGate(children: ChildrenFn) -> impl IntoView {
    let access = expect_context::<AccessContext>();
    access.open_gates.update_value(|open| *open += 1);
    on_cleanup(move || {
        access
            .open_gates
            .try_update_value(|open| *open = open.saturating_sub(1));
    });
    access.refresh();

    view! {
        {move || match access.state.get() {
            AccessState::Unchecked | AccessState::Checking => view! {
                <AccessShell>
                    <div class="access-status" role="status" aria-live="polite">
                        <span class="access-spinner" aria-hidden="true"></span>
                        <h1>"Checking your access"</h1>
                        <p>"Confirming your account and subscription…"</p>
                    </div>
                </AccessShell>
            }.into_any(),
            AccessState::SignedOut => view! {
                <AccessShell>
                    <div class="access-heading">
                        <p class="data-eyebrow">"Competition data"</p>
                        <h1>"Sign in to continue"</h1>
                        <p>"Use your MeetCal account before accessing subscription-only competition data."</p>
                    </div>
                    <ClerkSignIn />
                </AccessShell>
            }.into_any(),
            AccessState::Paid => children().into_any(),
            AccessState::Unpaid => view! {
                <MobileSubscriptionPage />
            }.into_any(),
            AccessState::Error(message) => view! {
                <AccessShell>
                    <div class="access-status access-error" role="alert">
                        <h1>"We couldn’t verify your access"</h1>
                        <p>{message}</p>
                        <button class="access-button" type="button" on:click=move |_| access.retry()>
                            "Try again"
                        </button>
                    </div>
                </AccessShell>
            }.into_any(),
        }}
    }
}

#[component]
fn AccessShell(children: Children) -> impl IntoView {
    view! {
        <div class="access-page">
            <section class="access-card">{children()}</section>
        </div>
    }
}

/// Clerk's sign-in, which returns to this page, query included, when done.
#[component]
pub fn ClerkSignIn() -> impl IntoView {
    let container = NodeRef::<leptos::html::Div>::new();

    Effect::new(move |_| {
        if let Some(element) = container.get() {
            mount_sign_in(&element);
        }
    });
    on_cleanup(move || {
        if let Some(element) = container.get_untracked() {
            unmount_sign_in(&element);
        }
    });

    view! { <div class="clerk-sign-in" node_ref=container></div> }
}

#[component]
pub fn MobileSubscriptionPage() -> impl IntoView {
    view! {
        <AccessShell>
            <div class="access-heading">
                <p class="data-eyebrow">"MeetCal subscription"</p>
                <h1>"Continue in the MeetCal app"</h1>
                <p>"Subscriptions are created and managed only in the mobile app. Sign in there with the same account you use on the web."</p>
            </div>
            <div class="purchase-benefits" aria-label="Subscription benefits">
                <span>"Qualifying totals"</span>
                <span>"Standards"</span>
                <span>"Results and rankings"</span>
                <span>"Competition records"</span>
            </div>
            <div class="mobile-subscription-links" aria-label="Open MeetCal on mobile">
                <a class="access-button" href=APP_STORE_URL>"Open on iPhone or iPad"</a>
                <a class="access-button access-button-secondary" href=PLAY_STORE_URL>"Open on Android"</a>
            </div>
            <p class="purchase-disclaimer">"In the app, open any premium feature to subscribe, or open My Profile, then Customer Support, to change, restore, or cancel a subscription. Existing access will appear here after the app store and MeetCal finish syncing your account."</p>
        </AccessShell>
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINUTE_MS: f64 = 60_000.0;

    #[test]
    fn a_recent_grant_is_not_checked_again_when_a_page_opens() {
        let now = 100.0 * MINUTE_MS;
        assert_eq!(
            recheck_on_open(
                &AccessState::Paid,
                Some(now - ACCESS_RECHECK_AFTER_MS + 1.0),
                now
            ),
            Recheck::No
        );
        assert_eq!(
            recheck_on_open(&AccessState::Paid, Some(now - ACCESS_RECHECK_AFTER_MS), now),
            Recheck::InBackground
        );
        assert_eq!(
            recheck_on_open(&AccessState::Paid, Some(now - MINUTE_MS), now),
            Recheck::No
        );
        assert_eq!(
            recheck_on_open(&AccessState::Paid, Some(now - 11.0 * MINUTE_MS), now),
            Recheck::InBackground
        );
        assert_eq!(
            recheck_on_open(&AccessState::Paid, None, now),
            Recheck::InBackground
        );
    }

    #[test]
    fn a_user_no_page_has_checked_is_checked_when_one_opens() {
        assert_eq!(
            recheck_on_open(&AccessState::Unchecked, None, 0.0),
            Recheck::Showing
        );
    }

    #[test]
    fn a_running_check_is_left_alone_and_a_refusal_is_checked_again() {
        assert_eq!(
            recheck_on_open(&AccessState::Checking, None, 0.0),
            Recheck::No
        );
        assert_eq!(
            recheck_on_open(&AccessState::Unpaid, Some(0.0), 1.0),
            Recheck::Showing
        );
        assert_eq!(
            recheck_on_open(&AccessState::Error("offline".to_owned()), None, 0.0),
            Recheck::Showing
        );
    }

    #[test]
    fn entitlement_answers_map_to_access() {
        assert_eq!(access_for(Ok(true)), AccessState::Paid);
        assert_eq!(access_for(Ok(false)), AccessState::Unpaid);
        assert_eq!(
            access_for(Err("boom".to_owned())),
            AccessState::Error("boom".to_owned())
        );
    }
}
