use super::catalog::DATA_PAGES;
use super::ui::DataPage;
use leptos::prelude::*;
use leptos_router::components::A;

#[component]
pub fn CompData() -> impl IntoView {
    view! {
        <DataPage
            heading="Find the Numbers You Need"
            intro="Browse meets, team performance, athlete history, qualification data, rankings, and records."
            section_class="data-page data-home"
        >
            <div class="data-card-grid">
                {DATA_PAGES
                    .iter()
                    .map(|page| view! {
                        <A href=page.path attr:class="data-card">
                            <h2>{page.label}</h2>
                            <p>{page.description}</p>
                        </A>
                    })
                    .collect_view()}
            </div>
        </DataPage>
    }
}
