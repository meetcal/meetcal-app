use crate::{
    auth::{AuthContext, AuthState, has_comp_data_access, mount_sign_in, unmount_sign_in},
    components::{footer::Footer, header::Header},
};
use leptos::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq)]
enum AccessState {
    Checking,
    SignedOut,
    Paid,
    Unpaid(String),
    Error(String),
}

#[component]
pub fn SubscriptionGate(children: ChildrenFn) -> impl IntoView {
    let auth = expect_context::<AuthContext>();
    let (access, set_access) = signal(AccessState::Checking);

    Effect::new(move |_| match auth.state.get() {
        AuthState::Loading => set_access.set(AccessState::Checking),
        AuthState::SignedOut => set_access.set(AccessState::SignedOut),
        AuthState::ConfigurationError(message) => set_access.set(AccessState::Error(message)),
        AuthState::SignedIn(user_id) => {
            set_access.set(AccessState::Checking);
            leptos::task::spawn_local(async move {
                let result = has_comp_data_access(&user_id).await;
                if auth.state.get_untracked() != AuthState::SignedIn(user_id.clone()) {
                    return;
                }

                match result {
                    Ok(true) => set_access.set(AccessState::Paid),
                    Ok(false) => set_access.set(AccessState::Unpaid(user_id)),
                    Err(message) => set_access.set(AccessState::Error(message)),
                }
            });
        }
    });

    view! {
        {move || match access.get() {
            AccessState::Checking => view! {
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
            AccessState::Unpaid(_) => view! {
                <MobileSubscriptionPage />
            }.into_any(),
            AccessState::Error(message) => view! {
                <AccessShell>
                    <div class="access-status access-error" role="alert">
                        <h1>"We couldn’t verify your access"</h1>
                        <p>{message}</p>
                        <button class="access-button" type="button" on:click=move |_| {
                            if let Some(window) = web_sys::window() {
                                let _ = window.location().reload();
                            }
                        }>
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
        <Header />
        <div class="access-page">
            <section class="access-card">{children()}</section>
        </div>
        <Footer />
    }
}

#[component]
fn ClerkSignIn() -> impl IntoView {
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
                <a class="access-button" href="https://apps.apple.com/us/app/meetcal/id6741133286">"Open on iPhone or iPad"</a>
                <a class="access-button access-button-secondary" href="https://play.google.com/store/apps/details?id=com.memohnsen.meetcal">"Open on Android"</a>
            </div>
            <p class="purchase-disclaimer">"In the app, open Settings to start, change, restore, or cancel a subscription. Existing access will appear here after the app store and MeetCal finish syncing your account."</p>
        </AccessShell>
    }
}
