use crate::auth::{AuthContext, AuthState};
use crate::components::subscription_gate::ClerkSignIn;
use crate::utils::page;
use leptos::prelude::*;

#[component]
pub fn SignedInOnly(
    eyebrow: &'static str,
    #[prop(into)] sign_in_prompt: ViewFn,
    children: ChildrenFn,
) -> impl IntoView {
    let auth = expect_context::<AuthContext>();
    auth.require_sign_in();

    move || match auth.state.get() {
        AuthState::Loading => view! {
            <div class="access-status" role="status" aria-live="polite">
                <span class="access-spinner" aria-hidden="true"></span>
                <h1>"Checking your sign-in"</h1>
            </div>
        }
        .into_any(),
        AuthState::SignedOut => view! {
            <div class="access-heading">
                <p class="data-eyebrow">{eyebrow}</p>
                <h1>"Sign in to continue"</h1>
                <p>{sign_in_prompt.run()}</p>
            </div>
            <ClerkSignIn />
        }
        .into_any(),
        AuthState::ConfigurationError(message) => view! {
            <div class="access-status access-error" role="alert">
                <h1>"Sign-in isn’t available"</h1>
                <p>{message}</p>
                <button class="access-button" type="button" on:click=move |_| page::reload()>
                    "Try again"
                </button>
            </div>
        }
        .into_any(),
        AuthState::SignedIn(_) => children().into_any(),
    }
}
