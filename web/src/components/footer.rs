use js_sys::Date;
use leptos::prelude::*;
use leptos_router::components::A;

use crate::components::store_links::{APP_STORE_URL, PLAY_STORE_URL};

#[component]
pub fn Footer() -> impl IntoView {
    let current_year = Date::new_0().get_full_year().to_string();

    view! {
        <footer class="site-footer">
            <h2>"Ready to transform your competition experience?"</h2>
            <div class="footer-ctas">
                <a class="footer-cta" href=APP_STORE_URL>"Download for iOS"</a>
                <a class="footer-cta footer-cta-secondary" href=PLAY_STORE_URL>
                    "Download for Android"
                </a>
            </div>

            <p>"© " {current_year} " MeetCal LLC. All rights reserved."</p>
            <nav class="footer-legal" aria-label="Legal">
                <A href="/privacy">"Privacy Policy"</A>
                <A href="/terms">"Terms of Use"</A>
            </nav>
        </footer>
    }
}
