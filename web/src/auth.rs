use leptos::prelude::*;
use wasm_bindgen::{JsCast, JsValue, closure::Closure, prelude::wasm_bindgen};
use wasm_bindgen_futures::JsFuture;

pub const CLERK_PUBLISHABLE_KEY: Option<&str> = option_env!("CLERK_PUBLISHABLE_KEY");
pub const REVENUECAT_PUBLIC_API_KEY: Option<&str> = option_env!("REVENUECAT_PUBLIC_API_KEY");

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
}

#[wasm_bindgen(module = "/src/auth_bridge.js")]
extern "C" {
    fn initialize_clerk(publishable_key: &str, callback: &js_sys::Function) -> js_sys::Promise;

    fn mount_clerk_user_button(element: &web_sys::HtmlElement);
    fn unmount_clerk_user_button(element: &web_sys::HtmlElement);
    fn mount_clerk_sign_in(element: &web_sys::HtmlElement);
    fn unmount_clerk_sign_in(element: &web_sys::HtmlElement);
    pub fn open_clerk_sign_in();

    fn check_revenuecat_entitlement(api_key: &str, app_user_id: &str) -> js_sys::Promise;

}

pub fn provide_auth() {
    let (state, set_state) = signal(AuthState::Loading);
    provide_context(AuthContext { state });

    let Some(publishable_key) = CLERK_PUBLISHABLE_KEY else {
        set_state.set(AuthState::ConfigurationError(
            "Clerk is not configured for this deployment.".to_owned(),
        ));
        return;
    };

    let callback = Closure::<dyn Fn(JsValue)>::new(move |user_id: JsValue| {
        if let Some(user_id) = user_id.as_string() {
            set_state.set(AuthState::SignedIn(user_id));
        } else {
            set_state.set(AuthState::SignedOut);
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

pub async fn has_comp_data_access(app_user_id: &str) -> Result<bool, String> {
    let api_key = REVENUECAT_PUBLIC_API_KEY
        .ok_or_else(|| "RevenueCat is not configured for this deployment.".to_owned())?;
    JsFuture::from(check_revenuecat_entitlement(api_key, app_user_id))
        .await
        .map(|value| value.as_bool().unwrap_or(false))
        .map_err(js_error_message)
}

fn js_error_message(error: JsValue) -> String {
    js_sys::Reflect::get(&error, &JsValue::from_str("message"))
        .ok()
        .and_then(|message| message.as_string())
        .or_else(|| error.as_string())
        .unwrap_or_else(|| "The authentication service could not be reached.".to_owned())
}
