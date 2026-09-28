use super::{
    athlete_autocomplete::AthleteAutocomplete,
    filters::{SortDirection, sort_numeric, sort_text},
    format::{format_us_date, yes_no},
    loading::load_error,
    models::{AthleteSearchQuery, AthleteSearchResponse, attempt},
    ui::{DataPage, DataStatus, DataTable, SortSelect, TableSkeleton},
};
use crate::utils::api::get_api_response_with_query;
use js_sys::Date;
use leptos::prelude::*;
use leptos_router::hooks::use_query_map;

fn search_date_range() -> (String, String) {
    let start = Date::new_0();
    start.set_full_year(start.get_full_year() - 20);

    let end = Date::new_0();
    end.set_date(end.get_date() + 1);

    (format_date(&start), format_date(&end))
}

fn format_date(date: &Date) -> String {
    format!(
        "{:04}-{:02}-{:02}",
        date.get_full_year(),
        date.get_month() + 1,
        date.get_date(),
    )
}

const SORT_OPTIONS: &[(&str, &str)] = &[
    ("date_desc", "Date: newest first"),
    ("date_asc", "Date: oldest first"),
    ("total_desc", "Total: high to low"),
    ("total_asc", "Total: low to high"),
];

#[component]
pub fn Results() -> impl IntoView {
    let initial_name = use_query_map()
        .with_untracked(|params| params.get("athlete"))
        .unwrap_or_default();
    let initial_request = (!initial_name.is_empty()).then(|| {
        let (start_date, end_date) = search_date_range();
        AthleteSearchQuery::between(initial_name.clone(), start_date, end_date)
    });
    let (name, set_name) = signal(initial_name);
    let (request, set_request) = signal(initial_request);
    let (sort, set_sort) = signal("date_desc".to_string());

    let results = LocalResource::new(move || {
        let request = request.get();
        async move {
            match request {
                Some(query) => {
                    get_api_response_with_query::<AthleteSearchResponse, _>("/search", &query)
                        .await
                        .map_err(|error| error.to_string())
                }
                None => Ok(AthleteSearchResponse {
                    matched_name: None,
                    suggestions: Vec::new(),
                    results: Vec::new(),
                }),
            }
        }
    });

    view! {
        <DataPage heading="Results" intro="Search an athlete’s competition history.">
            <ResultsSearchForm name set_name set_request />

            {move || results.with(|response| match response {
                None => view! { <TableSkeleton columns=14 /> }.into_any(),
                Some(Err(error)) => load_error("results", error),
                Some(Ok(_)) if request.get().is_none() => view! {
                    <DataStatus message="Enter an athlete name to search." />
                }
                .into_any(),
                Some(Ok(response)) => view! { <ResultsTable response=response.clone() sort set_sort /> }.into_any(),
            })}
        </DataPage>
    }
}

#[component]
fn ResultsSearchForm(
    name: ReadSignal<String>,
    set_name: WriteSignal<String>,
    set_request: WriteSignal<Option<AthleteSearchQuery>>,
) -> impl IntoView {
    view! {
        <form class="result-search" on:submit=move |event| {
            event.prevent_default();
            let athlete = name.get().trim().to_owned();
            if !athlete.is_empty() {
                let (start_date, end_date) = search_date_range();
                set_request.set(Some(AthleteSearchQuery::between(athlete, start_date, end_date)));
            }
        }>
            <AthleteAutocomplete value=name set_value=set_name input_id="results-athlete" />
            <button class="data-search-button" type="submit">"Search"</button>
        </form>
    }
}

#[component]
fn ResultsTable(
    response: AthleteSearchResponse,
    sort: ReadSignal<String>,
    set_sort: WriteSignal<String>,
) -> impl IntoView {
    let suggestions = (!response.suggestions.is_empty()).then(|| {
        view! { <p class="data-status">"Try: " {response.suggestions.join(", ")}</p> }
    });
    let heading = response.matched_name.map(|matched_name| {
        view! { <p class="data-status">"Results for " <strong>{matched_name}</strong></p> }
    });
    let results = StoredValue::new(response.results);

    view! {
        {heading}
        {suggestions}
        <div class="data-filters">
            <SortSelect options=SORT_OPTIONS set_sort />
        </div>
        <DataTable>
            <thead><tr><th>"Date"</th><th>"Meet"</th><th>"Division"</th><th>"Bodyweight"</th><th>"S1"</th><th>"S2"</th><th>"S3"</th><th>"Best snatch"</th><th>"C&J 1"</th><th>"C&J 2"</th><th>"C&J 3"</th><th>"Best C&J"</th><th>"Total"</th><th>"Adaptive"</th></tr></thead>
            <tbody>{move || results.with_value(|results| {
                let mut rows = results.iter().collect::<Vec<_>>();
                match sort.get().as_str() {
                    "date_asc" => sort_text(&mut rows, |row| &row.date, SortDirection::Ascending),
                    "total_desc" => sort_numeric(&mut rows, |row| row.total, SortDirection::Descending),
                    "total_asc" => sort_numeric(&mut rows, |row| row.total, SortDirection::Ascending),
                    _ => sort_text(&mut rows, |row| &row.date, SortDirection::Descending),
                }
                rows.into_iter().map(|row| view! { <tr><td>{format_us_date(&row.date)}</td><td>{row.meet.clone()}</td><td>{row.age.clone()}</td><td>{row.body_weight}</td><td>{attempt(row.snatch1)}</td><td>{attempt(row.snatch2)}</td><td>{attempt(row.snatch3)}</td><td>{row.snatch_best}</td><td>{attempt(row.cj1)}</td><td>{attempt(row.cj2)}</td><td>{attempt(row.cj3)}</td><td>{row.cj_best}</td><td>{row.total}</td><td>{yes_no(row.adaptive)}</td></tr> }).collect_view()
            })}</tbody>
        </DataTable>
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_response_deserializes_results_and_suggestions() {
        let response: AthleteSearchResponse = serde_json::from_str(
            r#"{"matched_name":"Test Athlete","suggestions":["Test Athlete Jr"],"results":[{"meet":"Nationals","date":"2026-06-20","age":"Senior","body_weight":70.5,"snatch1":95.0,"snatch2":100.0,"snatch3":-103.0,"snatch_best":100.0,"cj1":120.0,"cj2":125.0,"cj3":0.0,"cj_best":125.0,"total":225.0,"adaptive":false}]}"#,
        )
        .unwrap();

        assert_eq!(response.matched_name.as_deref(), Some("Test Athlete"));
        assert_eq!(response.suggestions, ["Test Athlete Jr"]);
        assert_eq!(response.results[0].total, 225.0);
        assert_eq!(response.results[0].snatch3, -103.0);
    }
}
