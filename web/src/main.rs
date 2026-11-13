#![recursion_limit = "256"]

use leptos::prelude::*;
use meetcal_web::{
    app::SiteRoutes, auth::provide_auth, components::subscription_gate::provide_access,
};

fn main() {
    leptos::mount::mount_to_body(App)
}

#[component]
fn App() -> impl IntoView {
    let path = web_sys::window()
        .and_then(|window| window.location().pathname().ok())
        .unwrap_or_default();
    provide_auth(&path);
    provide_access();

    view! { <SiteRoutes /> }
}
