use crate::components::{footer::Footer, header::Header};
use leptos::prelude::*;

#[component]
pub(crate) fn DataPage(
    heading: &'static str,
    intro: &'static str,
    #[prop(default = "data-page")] section_class: &'static str,
    children: Children,
) -> impl IntoView {
    view! {
        <Header />
        <section class=section_class>
            <p class="data-eyebrow">"Competition Data"</p>
            <h1>{heading}</h1>
            <p class="data-intro">{intro}</p>
            {children()}
        </section>
        <Footer />
    }
}

#[component]
pub(crate) fn DataStatus(message: &'static str) -> impl IntoView {
    view! { <p class="data-status">{message}</p> }
}

#[component]
pub(crate) fn SelectOptions(values: Vec<String>, selected: Option<String>) -> impl IntoView {
    values
        .into_iter()
        .map(|value| {
            let is_selected = selected.as_ref().is_some_and(|selected| selected == &value);

            view! {
                <option value=value.clone() selected=is_selected>
                    {value.clone()}
                </option>
            }
        })
        .collect_view()
}

#[component]
pub(crate) fn FilterSelect(
    label: &'static str,
    placeholder: &'static str,
    values: Vec<String>,
    selected: String,
    #[prop(into)] on_select: Callback<String>,
    #[prop(optional)] wide: bool,
) -> impl IntoView {
    let class = if wide {
        "data-filter data-filter-wide"
    } else {
        "data-filter"
    };

    view! {
        <label>
            {label}
            <select class=class on:change=move |event| on_select.run(event_target_value(&event))>
                <option value="">{placeholder}</option>
                <SelectOptions values selected=Some(selected) />
            </select>
        </label>
    }
}

#[component]
pub(crate) fn SortSelect(
    options: &'static [(&'static str, &'static str)],
    set_sort: WriteSignal<String>,
) -> impl IntoView {
    view! {
        <label class="data-sort">
            "Sort"
            <select class="data-filter" on:change=move |event| set_sort.set(event_target_value(&event))>
                {options
                    .iter()
                    .map(|(value, label)| view! { <option value=*value>{*label}</option> })
                    .collect_view()}
            </select>
        </label>
    }
}

#[component]
pub(crate) fn DataMetric(label: &'static str, value: String) -> impl IntoView {
    view! { <div class="data-metric"><span>{label}</span><strong>{value}</strong></div> }
}

#[component]
pub(crate) fn DataTable(children: Children) -> impl IntoView {
    view! {
        <div class="data-table-wrap">
            <table class="data-table">{children()}</table>
        </div>
    }
}

#[component]
pub(crate) fn TableSkeleton(columns: usize) -> impl IntoView {
    let header_cells = (0..columns)
        .map(|_| view! { <th><span class="data-skeleton"></span></th> })
        .collect_view();
    let rows = (0..8)
        .map(|_| {
            let cells = (0..columns)
                .map(|_| view! { <td><span class="data-skeleton"></span></td> })
                .collect_view();

            view! { <tr>{cells}</tr> }
        })
        .collect_view();

    view! {
        <div class="data-table-wrap" aria-busy="true" aria-label="Loading data">
            <table class="data-table data-table-skeleton">
                <thead><tr>{header_cells}</tr></thead>
                <tbody>{rows}</tbody>
            </table>
        </div>
    }
}

#[component]
pub(crate) fn EmptyTableRow(columns: usize, message: &'static str) -> impl IntoView {
    view! {
        <tr class="data-empty-row">
            <td colspan=columns>{message}</td>
        </tr>
    }
}
