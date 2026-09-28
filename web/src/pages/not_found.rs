use crate::components::{footer::Footer, header::Header};
use leptos::prelude::*;

#[component]
pub fn NotFound() -> impl IntoView {
    view! {
        <Header />
        <NotFoundSection />
        <Footer />
    }
}

#[component]
pub fn NotFoundSection() -> impl IntoView {
    view! {
        <h1>"Page Not Found"</h1>
    }
}
