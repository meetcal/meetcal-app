use leptos::prelude::*;

#[component]
pub fn FeatureSection(title: &'static str, subtitle: &'static str) -> impl IntoView {
    view! {
        <div>
            <h4>{title}</h4>
            <p>{subtitle}</p>
        </div>

    }
}
