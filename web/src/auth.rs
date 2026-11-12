use leptos::prelude::*;
use wasm_bindgen::{JsCast, JsValue, closure::Closure, prelude::wasm_bindgen};
use wasm_bindgen_futures::JsFuture;

pub const CLERK_PUBLISHABLE_KEY: Option<&str> = option_env!("CLERK_PUBLISHABLE_KEY");

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AuthState {
    Loading,
    SignedOut,
    SignedIn(String),
    ConfigurationError(String),
}

#[derive(Clone, Copy)]
pub struct AuthContext {
    pub state: ReadSignal<AuthState>,
    set_state: WriteSignal<AuthState>,
    started: StoredValue<bool>,
}

#[wasm_bindgen(module = "/src/auth_bridge.js")]
extern "C" {
    fn initialize_clerk(publishable_key: &str, callback: &js_sys::Function) -> js_sys::Promise;
    fn clerk_may_be_signed_in() -> bool;
    fn clerk_signed_in_user() -> Option<String>;

    fn mount_clerk_user_button(element: &web_sys::HtmlElement);
    fn unmount_clerk_user_button(element: &web_sys::HtmlElement);
    fn mount_clerk_sign_in(element: &web_sys::HtmlElement);
    fn unmount_clerk_sign_in(element: &web_sys::HtmlElement);
    fn open_clerk_sign_in() -> js_sys::Promise;

    fn clerk_session_token() -> js_sys::Promise;
    fn clerk_primary_email() -> Option<String>;
}

impl AuthContext {
    pub fn new(initial: AuthState) -> Self {
        let (state, set_state) = signal(initial);
        Self {
            state,
            set_state,
            started: StoredValue::new(false),
        }
    }

    pub fn prerendered(initial: AuthState) -> Self {
        let auth = Self::new(initial);
        auth.started.set_value(true);
        auth
    }

    pub fn require_sign_in(self) {
        if self.started.get_value() {
            return;
        }
        self.started.set_value(true);
        let Some(publishable_key) = CLERK_PUBLISHABLE_KEY else {
            self.set_state.set(AuthState::ConfigurationError(
                "Clerk is not configured for this deployment.".to_owned(),
            ));
            return;
        };
        if self.state.get_untracked() != AuthState::Loading {
            self.set_state.set(AuthState::Loading);
        }
        let state = self.state;
        let set_state = self.set_state;
        let callback = Closure::<dyn Fn(JsValue)>::new(move |user_id: JsValue| {
            let next = auth_state_for(user_id.as_string());
            let previous = state.get_untracked();
            if previous != next {
                crate::utils::api::forget_access_pass();
                if leaves_premium_answers_behind(&previous, &next) {
                    crate::utils::api::forget_premium_answers_kept();
                }
                set_state.set(next);
            }
        });
        let initialization = initialize_clerk(publishable_key, callback.as_ref().unchecked_ref());
        callback.forget();
        leptos::task::spawn_local(async move {
            if let Err(error) = JsFuture::from(initialization).await {
                set_state.set(AuthState::ConfigurationError(js_error_message(error)));
            }
        });
    }

    pub fn open_sign_in(self) {
        self.require_sign_in();
        let opening = open_clerk_sign_in();
        leptos::task::spawn_local(async move {
            if let Err(error) = JsFuture::from(opening).await {
                leptos::logging::warn!("Clerk sign-in did not open: {}", js_error_message(error));
            }
        });
    }
}

pub fn provide_auth(path: &str) {
    let loads_now = route_needs_sign_in(path) || clerk_may_be_signed_in();
    let auth = AuthContext::new(initial_auth_state(loads_now));
    provide_context(auth);
    if loads_now {
        auth.require_sign_in();
    }
}

pub fn initial_auth_state(loads_clerk_now: bool) -> AuthState {
    if loads_clerk_now {
        AuthState::Loading
    } else {
        AuthState::SignedOut
    }
}

pub const SIGNED_IN_ROUTES: [&str; 2] = ["/link", "/submit-meet"];

pub fn route_needs_sign_in(path: &str) -> bool {
    use crate::pages::comp_data::catalog::{Access, DATA_HOME, DATA_PAGES};
    SIGNED_IN_ROUTES.contains(&path)
        || DATA_PAGES
            .iter()
            .chain([&DATA_HOME])
            .any(|page| page.path == path && page.access == Access::Subscription)
}

pub fn leaves_premium_answers_behind(previous: &AuthState, next: &AuthState) -> bool {
    match next {
        AuthState::SignedOut => true,
        AuthState::SignedIn(now) => {
            matches!(previous, AuthState::SignedIn(before) if before != now)
        }
        AuthState::Loading | AuthState::ConfigurationError(_) => false,
    }
}

pub fn signed_in_user() -> Option<String> {
    clerk_signed_in_user()
}

/// The auth state for the user id Clerk reports (`None` when signed out).
fn auth_state_for(user_id: Option<String>) -> AuthState {
    match user_id {
        Some(user_id) => AuthState::SignedIn(user_id),
        None => AuthState::SignedOut,
    }
}

pub fn mount_user_button(element: &web_sys::HtmlElement) {
    mount_clerk_user_button(element);
}

pub fn unmount_user_button(element: &web_sys::HtmlElement) {
    unmount_clerk_user_button(element);
}

pub fn mount_sign_in(element: &web_sys::HtmlElement) {
    mount_clerk_sign_in(element);
}

pub fn unmount_sign_in(element: &web_sys::HtmlElement) {
    unmount_clerk_sign_in(element);
}

/// The signed-in user's Clerk session token, for the Convex calls that read
/// the caller: `accessPass:pass`, `entitlements:refresh`, and the
/// `deviceLogin:*` calls of `/link`. `None` when
/// signed out, or when Clerk could not hand one over (logged): premium reads
/// then go out without an access pass.
pub async fn session_token() -> Option<String> {
    match JsFuture::from(clerk_session_token()).await {
        Ok(token) => token.as_string().filter(|token| !token.is_empty()),
        Err(error) => {
            leptos::logging::warn!("No Clerk session token: {}", js_error_message(error));
            None
        }
    }
}

/// The signed-in user's primary email address in Clerk, for the reply-to of
/// a meet submission (`/submit-meet`). `None` when signed out or when the
/// user has none.
pub fn primary_email() -> Option<String> {
    clerk_primary_email()
}

fn js_error_message(error: JsValue) -> String {
    js_sys::Reflect::get(&error, &JsValue::from_str("message"))
        .ok()
        .and_then(|message| message.as_string())
        .or_else(|| error.as_string())
        .unwrap_or_else(|| "The authentication service could not be reached.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_routes_that_need_an_account_load_clerk_for_a_visitor_without_a_session() {
        for path in [
            "/records",
            "/comp-data",
            "/meet-center",
            "/link",
            "/submit-meet",
        ] {
            assert!(route_needs_sign_in(path), "{path}");
        }
        for path in [
            "/",
            "/features",
            "/privacy",
            "/terms",
            "/wrapped",
            "/subscription",
            "/missing",
        ] {
            assert!(!route_needs_sign_in(path), "{path}");
        }
        assert_eq!(initial_auth_state(true), AuthState::Loading);
        assert_eq!(initial_auth_state(false), AuthState::SignedOut);
    }

    #[test]
    fn premium_answers_kept_on_this_device_go_when_their_user_signs_out_or_changes() {
        let ada = AuthState::SignedIn("user_ada".to_owned());
        let bo = AuthState::SignedIn("user_bo".to_owned());
        assert!(leaves_premium_answers_behind(&ada, &AuthState::SignedOut));
        assert!(leaves_premium_answers_behind(
            &AuthState::Loading,
            &AuthState::SignedOut
        ));
        assert!(leaves_premium_answers_behind(&ada, &bo));
        assert!(!leaves_premium_answers_behind(&AuthState::Loading, &ada));
        assert!(!leaves_premium_answers_behind(&ada, &ada));
    }

    #[test]
    fn clerk_user_ids_map_to_auth_states() {
        assert_eq!(
            auth_state_for(Some("user_1".to_owned())),
            AuthState::SignedIn("user_1".to_owned())
        );
        assert_eq!(auth_state_for(None), AuthState::SignedOut);
    }
}
