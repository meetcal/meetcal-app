use super::{
    analytics::{WrappedStats, wrapped_stats},
    athlete_autocomplete::AthleteAutocomplete,
    loading::{Load, LoadState, load_error},
    models::{
        AthleteSearchQuery, AthleteSearchResponse, LiftResult, MAX_ATHLETE_CHOICES,
        distinct_athletes, normalize,
    },
    ui::{DataMetric, DataPage, DataStatus, TableSkeleton},
};
use crate::utils::api::{queries, query_with};
use js_sys::Date;
use leptos::prelude::*;

#[derive(Clone, PartialEq)]
struct WrappedRequest {
    athlete: String,
    year: i32,
    /// The name was picked from the athletes a search matched, so only an
    /// exact match for it is scored.
    picked: bool,
}

enum WrappedResponse {
    Report {
        athlete_name: String,
        year: i32,
        stats: WrappedStats,
    },
    /// Several athletes matched `query`; the user picks one. With
    /// `more_than_shown`, `names` may not hold the athlete meant: more
    /// matched than the list shows, or than the answer held.
    Choices {
        query: String,
        year: i32,
        names: Vec<String>,
        more_than_shown: bool,
    },
    /// The search answered, but there is no Wrapped to build (no results,
    /// or too many to score); says why.
    Unavailable(String),
}

/// What one Wrapped search found.
#[derive(Debug)]
enum WrappedSelection {
    /// One athlete's year: score these rows under `name`.
    Athlete { name: String, rows: Vec<LiftResult> },
    /// The names to pick from (see `WrappedResponse::Choices`).
    Choose {
        names: Vec<String>,
        more_than_shown: bool,
    },
}

#[component]
pub fn Wrapped() -> impl IntoView {
    let current_year = Date::new_0().get_full_year() as i32;
    let (athlete_name, set_athlete_name) = signal(String::new());
    let (year, set_year) = signal(current_year.to_string());
    let (request, set_request) = signal(None::<WrappedRequest>);
    let wrapped = Load::new(
        move || request.get(),
        |request| async move {
            match request {
                Some(request) => load_wrapped(request).await.map(Some),
                None => Ok(None),
            }
        },
    );
    view! { <DataPage heading="Athlete Wrapped" intro="Summarize an athlete’s competition year, best lifts, make rate, and progress.">
        <form class="data-query-form" on:submit=move |event| { event.prevent_default(); let athlete = athlete_name.get().trim().to_owned(); if athlete.is_empty() { return; } let selected_year = year.get().parse().unwrap_or(current_year); set_request.set(Some(WrappedRequest { athlete, year: selected_year, picked: false })); }>
            <AthleteAutocomplete value=athlete_name set_value=set_athlete_name input_id="wrapped-athlete" wrapper_class="data-query-grow" />
            <label>"Year"<input class="data-filter data-year-input" inputmode="numeric" maxlength="4" prop:value=current_year on:input=move |event| set_year.set(event_target_value(&event)) /></label>
            <button class="data-search-button" type="submit">"Build wrapped"</button>
        </form>
        {move || wrapped.with(|state| match state {
            LoadState::Loading => view! { <TableSkeleton columns=3 /> }.into_any(),
            LoadState::Failed(error) => load_error("wrapped", error, move || wrapped.retry()),
            LoadState::Ready(None) => view! { <DataStatus message="Enter an athlete to build their yearly recap." /> }.into_any(),
            LoadState::Ready(Some(WrappedResponse::Report { athlete_name, year, stats })) => report(athlete_name, *year, stats),
            LoadState::Ready(Some(WrappedResponse::Choices { query, year, names, more_than_shown })) => choices(query, *year, names, *more_than_shown, set_athlete_name, set_request),
            LoadState::Ready(Some(WrappedResponse::Unavailable(message))) => view! { <p class="data-status error">{format!("Could not build wrapped: {message}")}</p> }.into_any(),
        })}
    </DataPage> }
}

async fn load_wrapped(request: WrappedRequest) -> Result<WrappedResponse, String> {
    let year = request.year;
    let query = wrapped_search_query(&request.athlete, year);
    let response: AthleteSearchResponse = query_with(queries::SEARCH, &query)
        .await
        .map_err(|error| error.to_string())?;
    Ok(
        match select_wrapped(&request.athlete, year, request.picked, response) {
            Ok(WrappedSelection::Athlete { name, rows }) => WrappedResponse::Report {
                athlete_name: name,
                year,
                stats: wrapped_stats(&rows),
            },
            Ok(WrappedSelection::Choose {
                names,
                more_than_shown,
            }) => WrappedResponse::Choices {
                query: request.athlete,
                year,
                names,
                more_than_shown,
            },
            Err(message) => WrappedResponse::Unavailable(message),
        },
    )
}

/// The search for `athlete`'s results in `year`: January 1 through
/// December 31, both included, as `results:search` reads its range.
fn wrapped_search_query(athlete: &str, year: i32) -> AthleteSearchQuery {
    AthleteSearchQuery::between(
        athlete.to_owned(),
        format!("{year:04}-01-01"),
        format!("{year:04}-12-31"),
    )
}

/// Which rows one Wrapped scores, the athletes to pick from, or why there
/// are none; the app's `selectWrappedRows` (`src/lib/wrapped-search.ts`).
///
/// With an exact name match the answer sets `matched_name` and every row is
/// that athlete. Without one it falls back to every athlete whose name
/// contains the query ("Smith"); those rows are one person's year only when
/// they carry one distinct name, otherwise the user picks an athlete and a
/// Wrapped is built from an exact search for that name (`picked`).
///
/// A truncated answer is never scored or read as "no results": its rows may
/// miss part of the year, and a fallback that stopped scanning names may
/// have missed other athletes, or the one meant. A fallback's names are
/// offered to pick from; an exact match's year cannot be narrowed, so it is
/// refused.
fn select_wrapped(
    name: &str,
    year: i32,
    picked: bool,
    response: AthleteSearchResponse,
) -> Result<WrappedSelection, String> {
    let suffix = if response.suggestions.is_empty() {
        String::new()
    } else {
        format!(" Try: {}.", response.suggestions.join(", "))
    };
    let narrow = || format!("Too many athletes match {name}. Type more of the name.{suffix}");
    let none = || format!("No {year} results found for {name}.{suffix}");
    if response.results.is_empty() {
        return Err(if response.truncated { narrow() } else { none() });
    }

    if let Some(matched) = response.matched_name {
        // The query's own spelling; a row has the athlete's.
        let athlete = response
            .results
            .first()
            .map(|row| row.name.trim())
            .filter(|row_name| !row_name.is_empty())
            .map_or(matched, str::to_owned);
        if response.truncated {
            return Err(format!(
                "{athlete} has more {year} results than one search returns, so a Wrapped would miss some."
            ));
        }
        return Ok(WrappedSelection::Athlete {
            name: athlete,
            rows: response.results.into_iter().map(|row| row.result).collect(),
        });
    }
    if picked {
        // The picked name lifted this year, so its exact search should match.
        return Err(none());
    }

    // Distinct athletes among the fallback rows, keyed by folded name (which
    // also orders them), keeping the first spelling seen.
    let mut athletes = distinct_athletes(&response.results);
    if athletes.is_empty() {
        return Err(if response.truncated { narrow() } else { none() });
    }
    if athletes.len() == 1 && !response.truncated {
        let Some((key, athlete)) = athletes.pop_first() else {
            return Err(none());
        };
        let rows = response
            .results
            .into_iter()
            .filter(|row| normalize(&row.name) == key)
            .map(|row| row.result)
            .collect();
        return Ok(WrappedSelection::Athlete {
            name: athlete,
            rows,
        });
    }
    // The athletes that lifted in the year, so each pick has a Wrapped; the
    // answer's `suggestions` span every year.
    let more_than_shown = response.truncated || athletes.len() > MAX_ATHLETE_CHOICES;
    Ok(WrappedSelection::Choose {
        names: athletes.into_values().take(MAX_ATHLETE_CHOICES).collect(),
        more_than_shown,
    })
}

/// The first-to-last change as shown, the app's `formatImprovement`:
/// "+12kg", "-5kg", "Steady" for none, and "—" with fewer than two meets.
fn format_improvement(improvement: Option<f64>) -> String {
    match improvement {
        None => "—".to_owned(),
        Some(0.0) => "Steady".to_owned(),
        Some(change) => format!("{change:+}kg"),
    }
}

fn report(athlete_name: &str, year: i32, stats: &WrappedStats) -> AnyView {
    view! { <h2 class="data-section-title">{format!("{year} Wrapped — {athlete_name}")}</h2><div class="data-metric-grid"><DataMetric label="Meets" value=stats.total_meets.to_string() /><DataMetric label="Make rate" value=format!("{:.1}%", stats.make_percentage) /><DataMetric label="Best snatch" value=format!("{}kg", stats.best_snatch) /><DataMetric label="Best C&J" value=format!("{}kg", stats.best_cj) /><DataMetric label="Best total" value=format!("{}kg", stats.best_total) /><DataMetric label="Average total" value=format!("{:.1}kg", stats.average_total) /><DataMetric label="Weight lifted" value=format!("{}kg", stats.total_weight_lifted) /><DataMetric label="First-to-last" value=format_improvement(stats.improvement) /><DataMetric label="Longest make streak" value=stats.longest_streak.to_string() /><DataMetric label="Favorite attempt" value=stats.favorite_attempt.map(|value| value.to_string()).unwrap_or_else(|| "—".to_owned()) /></div><div class="wrapped-top-meet"><span>"Top meet"</span><strong>{stats.top_meet.clone().unwrap_or_else(|| "—".to_owned())}</strong></div> }.into_any()
}

/// The athletes a search matched, each building that athlete's Wrapped.
fn choices(
    query: &str,
    year: i32,
    names: &[String],
    more_than_shown: bool,
    set_athlete_name: WriteSignal<String>,
    set_request: WriteSignal<Option<WrappedRequest>>,
) -> AnyView {
    let message = if more_than_shown {
        format!("Many athletes match {query}. Pick one, or type more of the name.")
    } else {
        format!("Several athletes match {query}. Pick one.")
    };
    view! {
        <p class="data-status" role="status">{message}</p>
        <div class="wrapped-choices" role="group" aria-label="Matching athletes">
            {names.iter().cloned().map(|name| {
                let athlete = name.clone();
                view! {
                    <button type="button" on:click=move |_| {
                        set_athlete_name.set(athlete.clone());
                        set_request.set(Some(WrappedRequest { athlete: athlete.clone(), year, picked: true }));
                    }>{name}</button>
                }
            }).collect_view()}
        </div>
    }
    .into_any()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn first_to_last_reads_like_the_apps() {
        assert_eq!(format_improvement(None), "—");
        assert_eq!(format_improvement(Some(0.0)), "Steady");
        assert_eq!(format_improvement(Some(12.0)), "+12kg");
        assert_eq!(format_improvement(Some(-5.5)), "-5.5kg");
    }

    #[test]
    fn search_query_covers_the_calendar_year_inclusively() {
        let query = serde_json::to_value(wrapped_search_query("Test Athlete", 2026)).unwrap();
        assert_eq!(
            query,
            serde_json::json!({"query": "Test Athlete", "startDate": "2026-01-01", "endDate": "2026-12-31"})
        );
    }

    fn search_response(json: &str) -> AthleteSearchResponse {
        serde_json::from_str(json).unwrap()
    }

    fn row(name: &str, date: &str, total: f64) -> String {
        format!(
            r#"{{"name":"{name}","meet":"Meet {date}","date":"{date}","age":"Senior","body_weight":70.5,"snatch1":95.0,"snatch2":100.0,"snatch3":-103.0,"snatch_best":100.0,"cj1":120.0,"cj2":125.0,"cj3":0.0,"cj_best":125.0,"total":{total},"adaptive":false}}"#
        )
    }

    fn answer(
        matched_name: Option<&str>,
        rows: &[String],
        truncated: bool,
    ) -> AthleteSearchResponse {
        let matched_name = matched_name.map_or("null".to_owned(), |name| format!(r#""{name}""#));
        search_response(&format!(
            r#"{{"matched_name":{matched_name},"suggestions":["Ann Lee"],"results":[{}],"truncated":{truncated}}}"#,
            rows.join(",")
        ))
    }

    #[test]
    fn wrapped_scores_a_whole_exact_answer_under_the_athletes_spelling() {
        let response = answer(
            Some("test athlete"),
            &[row("Test Athlete", "2026-03-01", 220.0)],
            false,
        );
        let WrappedSelection::Athlete { name, rows } =
            select_wrapped("test athlete", 2026, false, response).unwrap()
        else {
            panic!("expected one athlete");
        };
        assert_eq!(name, "Test Athlete");
        assert_eq!(rows.len(), 1);
    }

    #[test]
    fn wrapped_refuses_an_exact_answer_that_was_cut() {
        let response = answer(
            Some("Test Athlete"),
            &[row("Test Athlete", "2026-03-01", 220.0)],
            true,
        );
        let error = select_wrapped("test athlete", 2026, false, response).unwrap_err();
        assert!(error.contains("would miss some"), "{error}");
    }

    #[test]
    fn wrapped_asks_to_narrow_a_cut_fallback_without_rows_rather_than_say_no_results() {
        let error = select_wrapped("an", 2026, false, answer(None, &[], true)).unwrap_err();
        assert!(error.contains("Type more of the name"), "{error}");
        assert!(!error.contains("No 2026 results"), "{error}");
    }

    #[test]
    fn wrapped_reports_no_results_with_the_suggestions() {
        let error = select_wrapped("Ann", 2026, false, answer(None, &[], false)).unwrap_err();
        assert_eq!(error, "No 2026 results found for Ann. Try: Ann Lee.");
    }

    #[test]
    fn wrapped_offers_a_pick_when_two_athletes_match_one_query() {
        let response = answer(
            None,
            &[
                row("John Smith", "2026-02-01", 200.0),
                row("Ann Smith", "2026-03-01", 180.0),
                row("john  smith", "2026-05-01", 210.0),
            ],
            false,
        );
        let WrappedSelection::Choose {
            names,
            more_than_shown,
        } = select_wrapped("Smith", 2026, false, response).unwrap()
        else {
            panic!("two athletes must not be scored as one");
        };
        // One entry per athlete, whatever the spelling, in name order.
        assert_eq!(names, ["Ann Smith", "John Smith"]);
        assert!(!more_than_shown);
    }

    #[test]
    fn wrapped_builds_a_picked_athlete_from_their_exact_search_only() {
        let fallback = answer(
            None,
            &[
                row("John Smith", "2026-02-01", 200.0),
                row("Ann Smith", "2026-03-01", 180.0),
            ],
            false,
        );
        let WrappedSelection::Choose { names, .. } =
            select_wrapped("Smith", 2026, false, fallback).unwrap()
        else {
            panic!("expected a pick list");
        };
        assert_eq!(names[1], "John Smith");

        // The pick searches the exact name, which answers with only that athlete.
        let exact = answer(
            Some("John Smith"),
            &[
                row("John Smith", "2026-02-01", 200.0),
                row("John Smith", "2026-05-01", 210.0),
            ],
            false,
        );
        let WrappedSelection::Athlete { name, rows } =
            select_wrapped(&names[1], 2026, true, exact).unwrap()
        else {
            panic!("expected one athlete");
        };
        assert_eq!(name, "John Smith");
        let stats = wrapped_stats(&rows);
        assert_eq!(stats.total_meets, 2);
        assert_eq!(stats.best_total, 210.0);
    }

    #[test]
    fn wrapped_never_scores_a_fallback_answer_for_a_picked_name() {
        let response = answer(None, &[row("John Smith", "2026-02-01", 200.0)], false);
        let error = select_wrapped("John Smith", 2026, true, response).unwrap_err();
        assert!(error.contains("No 2026 results"), "{error}");
    }

    #[test]
    fn wrapped_scores_a_fallback_with_one_athlete_and_skips_unnamed_rows() {
        let response = answer(
            None,
            &[
                row("Ann Lee", "2026-02-01", 150.0),
                row("", "2026-03-01", 300.0),
                row("ann lee ", "2026-04-01", 160.0),
            ],
            false,
        );
        let WrappedSelection::Athlete { name, rows } =
            select_wrapped("lee", 2026, false, response).unwrap()
        else {
            panic!("expected one athlete");
        };
        assert_eq!(name, "Ann Lee");
        assert_eq!(rows.len(), 2);
        assert_eq!(wrapped_stats(&rows).best_total, 160.0);
    }

    #[test]
    fn wrapped_offers_a_pick_rather_than_score_a_cut_fallback() {
        let response = answer(None, &[row("Ann Lee", "2026-02-01", 150.0)], true);
        let WrappedSelection::Choose {
            names,
            more_than_shown,
        } = select_wrapped("an", 2026, false, response).unwrap()
        else {
            panic!("a cut fallback must not be scored");
        };
        assert_eq!(names, ["Ann Lee"]);
        assert!(more_than_shown);
    }

    #[test]
    fn wrapped_caps_the_athletes_offered() {
        let rows = (0..12)
            .map(|index| row(&format!("Athlete {index:02}"), "2026-02-01", 150.0))
            .collect::<Vec<_>>();
        let WrappedSelection::Choose {
            names,
            more_than_shown,
        } = select_wrapped("Athlete", 2026, false, answer(None, &rows, false)).unwrap()
        else {
            panic!("expected a pick list");
        };
        assert_eq!(names.len(), MAX_ATHLETE_CHOICES);
        assert_eq!(names[0], "Athlete 00");
        // The answer was whole, but the list hides some athletes.
        assert!(more_than_shown);
    }

    #[test]
    fn suggestion_query_omits_the_dates() {
        let query =
            serde_json::to_value(AthleteSearchQuery::suggestions("Test".to_owned())).unwrap();
        assert_eq!(query, serde_json::json!({"query": "Test"}));
    }
}
