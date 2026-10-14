use leptos::prelude::*;
use leptos_router::components::A;

#[component]
pub fn NotFound() -> impl IntoView {
    view! { <NotFoundSection /> }
}

#[component]
pub fn NotFoundSection() -> impl IntoView {
    view! {
        <section class="not-found">
            <h1>"Page Not Found"</h1>
            <p>"This page doesn’t exist, or it has moved."</p>
            <nav class="not-found-links" aria-label="Where to go next">
                <A href="/">"Go to the home page"</A>
                <A href="/comp-data">"Browse competition data"</A>
            </nav>
        </section>
    }
}
