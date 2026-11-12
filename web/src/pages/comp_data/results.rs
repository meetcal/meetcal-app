use super::{
    address::{HistoryEntry, address, query_param, use_page_address},
    athlete_autocomplete::AthleteAutocomplete,
    catalog,
    filters::{SortDirection, sort_numeric, sort_orders, sort_text},
    format::{display_body_weight, format_us_date, yes_no},
    loading::{Load, LoadState, load_error},
    models::{
        AthleteSearchQuery, AthleteSearchResponse, LiftingResult, MAX_ATHLETE_CHOICES, attempt,
        distinct_athletes, normalize,
    },
    reference_table::position_in,
    ui::{DataPage, DataStatus, RowsTable, SortSelect, TableSkeleton},
};
use crate::utils::api::{queries, query_with};
use js_sys::Date;
use leptos::prelude::*;
use leptos_router::components::A;

/// The last twenty years, through today: `results:search` includes both ends of the range.
fn search_date_range() -> (String, String) {
    let start = Date::new_0();
    start.set_full_year(start.get_full_year() - 20);

    let end = Date::new_0();

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

sort_orders!(ResultSort {
    DateDesc => ("date_desc", "Date: newest first"),
    DateAsc => ("date_asc", "Date: oldest first"),
    TotalDesc => ("total_desc", "Total: high to low"),
    TotalAsc => ("total_asc", "Total: low to high"),
});

pub(crate) fn results_url(athlete: &str) -> String {
    address("/results", &[("athlete", athlete)])
}

/// What one Results search answered, ready to show.
#[derive(Debug)]
enum ResultsAnswer {
    /// Nothing matched `query`; `suggestions` are names to try. With `cut`,
    /// the server stopped before reading every matching name, so a name it
    /// did not reach may have results: the query needs narrowing.
    Empty {
        query: String,
        suggestions: Vec<String>,
        cut: bool,
    },
    /// One athlete's history, under the athlete's stored spelling.
    Athlete {
        name: String,
        rows: Vec<LiftingResult>,
        truncated: bool,
        suggestions: Vec<String>,
    },
    /// No athlete is named `query` exactly and several names contain it; each
    /// name searches that athlete. With `more_than_shown`, the athlete meant
    /// may not be among them.
    Choose {
        query: String,
        names: Vec<String>,
        more_than_shown: bool,
    },
}

/// What an empty answer says: a cut one was not a full search.
fn empty_message(query: &str, cut: bool) -> String {
    if cut {
        format!(
            "Too many names contain {query} to search them all, and none searched has results. Type more of the name."
        )
    } else {
        format!("No results found for {query}.")
    }
}

fn results_answer(query: &str, response: AthleteSearchResponse) -> ResultsAnswer {
    let AthleteSearchResponse {
        matched_name,
        suggestions,
        results,
        truncated,
    } = response;
    if results.is_empty() {
        return ResultsAnswer::Empty {
            query: query.to_owned(),
            suggestions,
            cut: truncated,
        };
    }
    if let Some(matched) = matched_name {
        return ResultsAnswer::Athlete {
            name: matched,
            rows: results,
            truncated,
            suggestions,
        };
    }

    let mut athletes = distinct_athletes(&results);
    if athletes.len() == 1
        && !truncated
        && let Some((key, name)) = athletes.pop_first()
    {
        let rows = results
            .into_iter()
            .filter(|row| normalize(&row.name) == key)
            .collect();
        return ResultsAnswer::Athlete {
            name,
            rows,
            truncated,
            suggestions,
        };
    }
    if athletes.is_empty() {
        return ResultsAnswer::Empty {
            query: query.to_owned(),
            suggestions,
            cut: truncated,
        };
    }
    let more_than_shown = truncated || athletes.len() > MAX_ATHLETE_CHOICES;
    ResultsAnswer::Choose {
        query: query.to_owned(),
        names: athletes.into_values().take(MAX_ATHLETE_CHOICES).collect(),
        more_than_shown,
    }
}

#[component]
pub fn Results() -> impl IntoView {
    let athlete = query_param("athlete");
    let request = Memo::new(move |_| {
        let athlete = athlete.get();
        (!athlete.is_empty()).then(|| {
            let (start_date, end_date) = search_date_range();
            AthleteSearchQuery::between(athlete, start_date, end_date)
        })
    });
    let (name, set_name) = signal(athlete.get_untracked());
    Effect::new(move |previous: Option<()>| {
        let athlete = athlete.get();
        if previous.is_some() {
            set_name.set(athlete);
        }
    });
    let (sort, set_sort) = signal(ResultSort::DateDesc);

    let results = Load::new(
        move || request.get(),
        |request| async move {
            let Some(query) = request else {
                return Ok(None);
            };
            query_with::<AthleteSearchResponse, _>(queries::SEARCH, &query)
                .await
                .map(|response| Some(results_answer(&query.query, response)))
                .map_err(|error| error.to_string())
        },
    );

    view! {
        <DataPage page=catalog::RESULTS>
            <ResultsSearchForm name set_name current=athlete search_again=Callback::new(move |()| results.retry()) />

            // Nothing asked yet is the prompt at once, never a loading skeleton.
            {move || if request.with(Option::is_none) {
                view! { <DataStatus message="Enter an athlete name to search." /> }.into_any()
            } else { results.with(|state| match state {
                LoadState::Loading => view! { <TableSkeleton columns=14 /> }.into_any(),
                LoadState::Failed(error) => load_error("results", error, move || results.retry()),
                LoadState::Ready(None) => view! {
                    <DataStatus message="Enter an athlete name to search." />
                }
                .into_any(),
                LoadState::Ready(Some(ResultsAnswer::Empty { query, suggestions, cut })) => view! {
                    <p class="data-status" role="status">{empty_message(query, *cut)}</p>
                    <Suggestions names=suggestions.clone() />
                }
                .into_any(),
                LoadState::Ready(Some(ResultsAnswer::Choose { query, names, more_than_shown })) => {
                    let message = if *more_than_shown {
                        format!("No athlete is named {query} exactly, and many names contain it. Pick one, or type more of the name.")
                    } else {
                        format!("No athlete is named {query} exactly. Pick one of the athletes whose name contains it.")
                    };
                    view! {
                        <p class="data-status" role="status">{message}</p>
                        <div class="wrapped-choices" role="group" aria-label="Matching athletes">
                            {names.clone().into_iter().map(|name| view! { <A href=results_url(&name)>{name}</A> }).collect_view()}
                        </div>
                    }
                    .into_any()
                }
                LoadState::Ready(Some(ResultsAnswer::Athlete { name, rows, truncated, suggestions })) => view! {
                    <ResultsTable name=name.clone() rows=rows.clone() truncated=*truncated suggestions=suggestions.clone() sort set_sort />
                }
                .into_any(),
            }) }}
        </DataPage>
    }
}

#[component]
/// Searches by moving to the athlete's URL; searching again for the athlete
/// the URL already names sends the search again (`search_again`), since the
/// URL, and so the request, does not change.
fn ResultsSearchForm(
    name: ReadSignal<String>,
    set_name: WriteSignal<String>,
    current: Memo<String>,
    search_again: Callback<()>,
) -> impl IntoView {
    let page = use_page_address("/results");
    view! {
        <form class="result-search" on:submit=move |event| {
            event.prevent_default();
            let athlete = name.get();
            if athlete.trim().is_empty() {
                return;
            }
            if athlete.trim() == current.get_untracked() {
                search_again.run(());
            } else {
                page.show(&[("athlete", &athlete)], HistoryEntry::Push);
            }
        }>
            <AthleteAutocomplete value=name set_value=set_name input_id="results-athlete" />
            <button class="data-search-button" type="submit">"Search"</button>
        </form>
    }
}

/// Names to try, each searching that athlete.
#[component]
fn Suggestions(names: Vec<String>) -> impl IntoView {
    (!names.is_empty()).then(move || {
        let links = names
            .into_iter()
            .enumerate()
            .map(|(index, name)| {
                view! {
                    {(index > 0).then_some(", ")}
                    <A href=results_url(&name)>{name}</A>
                }
            })
            .collect_view();
        view! { <p class="data-status">"Try: " {links}</p> }
    })
}

const RESULT_HEADERS: &[&str] = &[
    "Date",
    "Meet",
    "Division",
    "Bodyweight",
    "S1",
    "S2",
    "S3",
    "Best snatch",
    "C&J 1",
    "C&J 2",
    "C&J 3",
    "Best C&J",
    "Total",
    "Adaptive",
];

fn result_row(row: &LiftingResult) -> AnyView {
    view! { <tr><td>{format_us_date(&row.date)}</td><td>{row.meet.clone()}</td><td>{row.age.clone()}</td><td>{display_body_weight(row.body_weight)}</td><td>{attempt(row.snatch1)}</td><td>{attempt(row.snatch2)}</td><td>{attempt(row.snatch3)}</td><td>{row.snatch_best}</td><td>{attempt(row.cj1)}</td><td>{attempt(row.cj2)}</td><td>{attempt(row.cj3)}</td><td>{row.cj_best}</td><td>{row.total}</td><td>{yes_no(row.adaptive)}</td></tr> }.into_any()
}

#[component]
fn ResultsTable(
    name: String,
    rows: Vec<LiftingResult>,
    truncated: bool,
    suggestions: Vec<String>,
    sort: ReadSignal<ResultSort>,
    set_sort: WriteSignal<ResultSort>,
) -> impl IntoView {
    let truncated = truncated.then(|| {
        view! {
            <p class="data-status">
                "More results match than one search shows; these are the most recent. Type more of the name to narrow it."
            </p>
        }
    });
    let results = StoredValue::new(rows);
    let order = Memo::new(move |_| {
        let order = sort.get();
        results.with_value(|results| {
            let mut rows = results.iter().collect::<Vec<_>>();
            match order {
                ResultSort::DateAsc => {
                    sort_text(&mut rows, |row| &row.date, SortDirection::Ascending)
                }
                ResultSort::TotalDesc => {
                    sort_numeric(&mut rows, |row| row.total, SortDirection::Descending)
                }
                ResultSort::TotalAsc => {
                    sort_numeric(&mut rows, |row| row.total, SortDirection::Ascending)
                }
                ResultSort::DateDesc => {
                    sort_text(&mut rows, |row| &row.date, SortDirection::Descending)
                }
            }
            rows.into_iter()
                .map(|row| position_in(results, row))
                .collect::<Vec<_>>()
        })
    });

    view! {
        <p class="data-status">"Results for " <strong>{name}</strong></p>
        <Suggestions names=suggestions />
        {truncated}
        <div class="data-filters">
            <SortSelect<ResultSort> sort=sort on_sort=move |order: ResultSort| set_sort.set(order) />
        </div>
        <RowsTable headers=RESULT_HEADERS rows=results order row=result_row empty_message="No results were found for this athlete." />
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_athletes_results_link_is_built_like_every_other_page_address() {
        assert_eq!(
            results_url("  O'Neil & José "),
            address("/results", &[("athlete", "O'Neil & José")])
        );
        assert_eq!(
            results_url("O'Neil & José"),
            "/results?athlete=O%27Neil%20%26%20Jos%C3%A9"
        );
    }

    #[test]
    fn search_response_deserializes_results_and_suggestions() {
        let response: AthleteSearchResponse = serde_json::from_str(
            r#"{"matched_name":"Test Athlete","suggestions":["Test Athlete Jr"],"results":[{"name":"Test Athlete","meet":"Nationals","date":"2026-06-20","age":"Senior","body_weight":70.5,"snatch1":95.0,"snatch2":100.0,"snatch3":-103.0,"snatch_best":100.0,"cj1":120.0,"cj2":125.0,"cj3":0.0,"cj_best":125.0,"total":225.0,"adaptive":false}],"truncated":false}"#,
        )
        .unwrap();

        assert_eq!(response.matched_name.as_deref(), Some("Test Athlete"));
        assert_eq!(response.suggestions, ["Test Athlete Jr"]);
        assert_eq!(response.results[0].total, 225.0);
        assert_eq!(response.results[0].snatch3, -103.0);
        assert!(!response.truncated);
    }

    #[test]
    fn a_search_answer_that_does_not_say_whether_it_was_cut_is_unreadable() {
        let answer_without_truncated =
            r#"{"matched_name":null,"suggestions":["Ann Smith"],"results":[]}"#;
        assert!(serde_json::from_str::<AthleteSearchResponse>(answer_without_truncated).is_err());
    }

    #[test]
    fn search_response_reads_truncated() {
        let response: AthleteSearchResponse = serde_json::from_str(
            r#"{"matched_name":null,"suggestions":["Ann Smith"],"results":[],"truncated":true}"#,
        )
        .unwrap();

        assert!(response.truncated);
    }

    fn row(name: &str, date: &str) -> String {
        format!(
            r#"{{"name":"{name}","meet":"Meet {date}","date":"{date}","age":"Senior","body_weight":70.5,"snatch1":95.0,"snatch2":100.0,"snatch3":-103.0,"snatch_best":100.0,"cj1":120.0,"cj2":125.0,"cj3":0.0,"cj_best":125.0,"total":225.0,"adaptive":false}}"#
        )
    }

    fn answer(
        matched_name: Option<&str>,
        rows: &[String],
        truncated: bool,
    ) -> AthleteSearchResponse {
        let matched_name = matched_name.map_or("null".to_owned(), |name| format!(r#""{name}""#));
        serde_json::from_str(&format!(
            r#"{{"matched_name":{matched_name},"suggestions":["Ann Lee"],"results":[{}],"truncated":{truncated}}}"#,
            rows.join(",")
        ))
        .unwrap()
    }

    #[test]
    fn an_exact_match_is_headed_with_the_matched_name_whatever_its_rows_spell() {
        let response = answer(
            Some("Amelia Phillips"),
            &[
                row("AMELIA PHILLIPS", "2025-03-01"),
                row("Amelia Phillips", "2026-03-01"),
            ],
            false,
        );
        let ResultsAnswer::Athlete { name, rows, .. } =
            results_answer("amelia  PHILLIPS", response)
        else {
            panic!("expected one athlete");
        };
        assert_eq!(name, "Amelia Phillips");
        assert_eq!(rows.len(), 2);
    }

    #[test]
    fn one_athlete_in_a_fallback_is_headed_with_the_newest_spelling() {
        let response = answer(
            None,
            &[
                row("AMELIA PHILLIPS", "2025-03-01"),
                row(" Amelia Phillips ", "2026-03-01"),
            ],
            false,
        );
        let ResultsAnswer::Athlete { name, rows, .. } = results_answer("phillips", response) else {
            panic!("expected one athlete");
        };
        assert_eq!(name, "Amelia Phillips");
        assert_eq!(rows.len(), 2);
    }

    #[test]
    fn several_athletes_in_a_fallback_are_offered_by_their_newest_spelling_not_merged() {
        let response = answer(
            None,
            &[
                row("john  smith", "2026-02-01"),
                row("Ann Smith", "2026-03-01"),
                row("John Smith", "2026-05-01"),
            ],
            false,
        );
        let ResultsAnswer::Choose {
            names,
            more_than_shown,
            ..
        } = results_answer("Smith", response)
        else {
            panic!("two athletes must not be shown as one history");
        };
        assert_eq!(names, ["Ann Smith", "John Smith"]);
        assert!(!more_than_shown);
    }

    #[test]
    fn a_fallback_with_one_athlete_in_two_unicode_forms_is_their_history() {
        let response = answer(
            None,
            &[
                row("Jos\u{e9} Cruz", "2026-02-01"),
                row("Jose\u{301} Cruz", "2026-03-01"),
            ],
            false,
        );
        let ResultsAnswer::Athlete { name, rows, .. } = results_answer("Cruz", response) else {
            panic!("one athlete in two spellings is one athlete");
        };
        assert_eq!(name, "Jose\u{301} Cruz");
        assert_eq!(rows.len(), 2);
    }

    #[test]
    fn a_cut_fallback_is_a_pick_list_that_says_so() {
        let response = answer(None, &[row("Ann Lee", "2026-02-01")], true);
        let ResultsAnswer::Choose {
            more_than_shown, ..
        } = results_answer("an", response)
        else {
            panic!("a cut fallback may hide other athletes");
        };
        assert!(more_than_shown);
    }

    #[test]
    fn no_rows_is_an_empty_answer_with_suggestions() {
        let ResultsAnswer::Empty {
            query,
            suggestions,
            cut,
        } = results_answer("zzqx", answer(None, &[], false))
        else {
            panic!("expected an empty answer");
        };
        assert_eq!(query, "zzqx");
        assert_eq!(suggestions, ["Ann Lee"]);
        assert!(!cut);
        assert_eq!(empty_message("zzqx", cut), "No results found for zzqx.");
    }

    #[test]
    fn a_cut_empty_answer_asks_to_narrow_the_search() {
        let ResultsAnswer::Empty { query, cut, .. } = results_answer("an", answer(None, &[], true))
        else {
            panic!("expected an empty answer");
        };
        assert!(cut);
        let message = empty_message(&query, cut);
        assert!(message.contains("Type more of the name"), "{message}");
        assert!(!message.starts_with("No results found"), "{message}");
    }

    #[test]
    fn every_sort_order_in_the_menu_is_one_the_table_sorts_by() {
        crate::pages::comp_data::filters::assert_each_sort_order_parses_to_itself::<ResultSort>();
    }
}
