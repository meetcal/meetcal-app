use crate::auth::{
    AuthContext, AuthState, mount_user_button, open_clerk_sign_in, unmount_user_button,
};
use crate::pages::comp_data::catalog::DATA_PAGES;
use leptos::prelude::*;
use leptos_router::components::A;

#[component]
pub fn Header() -> impl IntoView {
    let auth = expect_context::<AuthContext>();

    view! {
        <header class="site-header">
            <A href="/" attr:class="brand-link">
                <img class="brand-logo" src="/images/logo.png" alt="MeetCal" />
                <span>"MeetCal"</span>
            </A>
            <nav class="site-nav" aria-label="Primary navigation">
                <div class="nav-menu">
                    <button class="nav-menu-trigger" type="button" aria-haspopup="true">"Products"</button>
                    <div class="nav-menu-panel">
                        <a href="https://wargames.meetcal.app">"War Games"</a>
                        <A href="/atlas">"Atlas"</A>
                    </div>
                </div>
                <div class="nav-menu">
                    <A href="/comp-data" attr:class="nav-menu-trigger">"Competition Data"</A>
                    <div class="nav-menu-panel">
                        {DATA_PAGES
                            .iter()
                            .map(|page| view! { <A href=page.path>{page.label}</A> })
                            .collect_view()}
                    </div>
                </div>
                <A href="/features">"Features"</A>
                <A href="/privacy">"Privacy"</A>
                <A href="/terms">"Terms"</A>
                <A href="mailto:maddisen@meetcal.app">"Contact Us"</A>
            </nav>
            <details class="mobile-nav">
                <summary aria-label="Open navigation menu">
                    <span class="mobile-nav-icon" aria-hidden="true"></span>
                </summary>
                <nav class="mobile-nav-panel" aria-label="Mobile navigation">
                    <span class="mobile-nav-heading">"Products"</span>
                    <a href="https://wargames.meetcal.app">"War Games"</a>
                    <A href="/atlas">"Atlas"</A>
                    <A href="/comp-data">"Competition Data"</A>
                    <A href="/features">"Features"</A>
                    <A href="/privacy">"Privacy"</A>
                    <A href="/terms">"Terms"</A>
                    <A href="mailto:maddisen@meetcal.app">"Contact Us"</A>
                    <div class="mobile-nav-socials">
                        <a
                            href="https://www.instagram.com/meetcalapp/"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            "Instagram"
                        </a>
                        <a
                            href="https://github.com/meetcal"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            "GitHub"
                        </a>
                    </div>
                </nav>
            </details>
            <div class="header-actions">
                <nav class="social-links" aria-label="MeetCal social media">
                    <a
                        class="social-link"
                        href="https://www.instagram.com/meetcalapp/"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="MeetCal on Instagram"
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="3" y="3" width="18" height="18" rx="5"></rect>
                            <circle cx="12" cy="12" r="4"></circle>
                            <circle class="social-icon-dot" cx="17.5" cy="6.5" r="1"></circle>
                        </svg>
                    </a>
                    <a
                        class="social-link"
                        href="https://github.com/meetcal"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="MeetCal on GitHub"
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M12 2.75a9.25 9.25 0 0 0-2.93 18.03c.46.08.63-.2.63-.44v-1.8c-2.57.56-3.11-1.09-3.11-1.09-.42-1.07-1.03-1.35-1.03-1.35-.84-.58.06-.57.06-.57.93.07 1.42.96 1.42.96.83 1.42 2.17 1.01 2.7.77.08-.6.32-1.01.59-1.25-2.05-.23-4.21-1.03-4.21-4.57 0-1.01.36-1.84.95-2.49-.1-.23-.41-1.18.09-2.46 0 0 .78-.25 2.54.95A8.8 8.8 0 0 1 12 7.08a8.8 8.8 0 0 1 2.31.31c1.76-1.2 2.54-.95 2.54-.95.5 1.28.19 2.23.09 2.46.59.65.95 1.48.95 2.49 0 3.55-2.16 4.33-4.22 4.56.33.29.63.85.63 1.72v2.67c0 .24.17.52.64.43A9.25 9.25 0 0 0 12 2.75Z"></path>
                        </svg>
                    </a>
                </nav>
                {move || match auth.state.get() {
                    AuthState::SignedIn(_) => view! { <ClerkUserButton /> }.into_any(),
                    AuthState::Loading => view! {
                        <span class="auth-button-placeholder" aria-hidden="true"></span>
                    }.into_any(),
                    AuthState::SignedOut => view! {
                        <button class="profile-button" type="button" on:click=move |_| open_clerk_sign_in()>
                            "Sign in"
                        </button>
                    }.into_any(),
                    AuthState::ConfigurationError(_) => view! {
                        <button class="profile-button" type="button" disabled=true>"Sign in"</button>
                    }.into_any(),
                }}
            </div>
        </header>
    }
}

#[component]
fn ClerkUserButton() -> impl IntoView {
    let container = NodeRef::<leptos::html::Div>::new();

    Effect::new(move |_| {
        if let Some(element) = container.get() {
            mount_user_button(&element);
        }
    });
    on_cleanup(move || {
        if let Some(element) = container.get_untracked() {
            unmount_user_button(&element);
        }
    });

    view! { <div class="clerk-user-button" node_ref=container></div> }
}
