//! Athlete Wrapped: one athlete's calendar year, summed up by the server
//! (`results:wrapped`, `convex/lib/wrapped.ts`), the same answer the app and
//! the CLI show. The query is public, so the page is free: it sits outside the
//! subscription gate and never reads the results behind the stats.

use super::{
    athlete_autocomplete::AthleteAutocomplete,
    loading::{Load, LoadState, load_error},
    ui::{DataMetric, DataPage, DataStatus, TableSkeleton},
};
use crate::utils::api::{queries, query_with};
use js_sys::Date;
use leptos::prelude::*;
use serde::{Deserialize, Serialize};

/// One Wrapped search: `results:wrapped`'s arguments.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct WrappedRequest {
    query: String,
    year: i32,
    /// The name was picked from the athletes a search matched, so the server
    /// takes only an exact match for it. Sent only when set, as the app does.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    picked: bool,
}

/// `results:wrapped`'s answer.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum WrappedAnswer {
    /// One athlete's year, under the athlete's own spelling.
    Athlete { name: String, stats: WrappedStats },
    /// Several athletes matched; the user picks one, which asks again with
    /// `picked`. With `truncated`, `names` may not hold the athlete meant.
    Ambiguous {
        names: Vec<String>,
        #[serde(default)]
        truncated: bool,
    },
    /// The name matched too many athletes to look through: type more of it.
    Narrow,
    /// One athlete's year has more results than one answer holds, so a
    /// Wrapped would miss some.
    TooManyResults { name: String },
    /// No results in the year; `suggestions` are names like the query.
    #[serde(rename = "none")]
    NoResults {
        #[serde(default)]
        suggestions: Vec<String>,
    },
}

/// The year's stats, as the server scored them.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct WrappedStats {
    total_weight_lifted: f64,
    total_meets: u32,
    /// Made attempts over taken attempts, 0–100.
    make_percentage: f64,
    best_snatch: f64,
    best_clean_jerk: f64,
    best_total: f64,
    average_total: f64,
    /// The meet with the year's best total; `None` without one.
    #[serde(default)]
    top_meet: Option<String>,
    /// Last minus first meet's best total; `None` with fewer than two meets.
    #[serde(default)]
    improvement_from_first: Option<f64>,
    longest_make_streak: u32,
    /// The attempt (1, 2 or 3) made most often; `None` when none was made.
    #[serde(default)]
    favorite_attempt: Option<u8>,
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
                Some(request) => query_with::<WrappedAnswer, _>(queries::WRAPPED, &request)
                    .await
                    .map(|answer| Some((request, answer)))
                    .map_err(|error| error.to_string()),
                None => Ok(None),
            }
        },
    );
    view! { <DataPage heading="Athlete Wrapped" intro="Summarize an athlete’s competition year, best lifts, make rate, and progress.">
        <form class="data-query-form" on:submit=move |event| { event.prevent_default(); let athlete = athlete_name.get().trim().to_owned(); if athlete.is_empty() { return; } let selected_year = year.get().parse().unwrap_or(current_year); wrapped.submit(|| set_request.set(Some(WrappedRequest { query: athlete, year: selected_year, picked: false }))); }>
            <AthleteAutocomplete value=athlete_name set_value=set_athlete_name input_id="wrapped-athlete" wrapper_class="data-query-grow" />
            <label>"Year"<input class="data-filter data-year-input" inputmode="numeric" maxlength="4" prop:value=current_year on:input=move |event| set_year.set(event_target_value(&event)) /></label>
            <button class="data-search-button" type="submit">"Build wrapped"</button>
        </form>
        // Nothing asked yet is the prompt at once, never a loading skeleton.
        {move || if request.with(Option::is_none) {
            view! { <DataStatus message="Enter an athlete to build their yearly recap." /> }.into_any()
        } else { wrapped.with(|state| match state {
            LoadState::Loading => view! { <TableSkeleton columns=3 /> }.into_any(),
            LoadState::Failed(error) => load_error("wrapped", error, move || wrapped.retry()),
            LoadState::Ready(None) => view! { <DataStatus message="Enter an athlete to build their yearly recap." /> }.into_any(),
            LoadState::Ready(Some((request, answer))) => match answer {
                WrappedAnswer::Athlete { name, stats } => report(name, request.year, stats),
                WrappedAnswer::Ambiguous { names, truncated } => choices(&request.query, request.year, names, *truncated, set_athlete_name, set_request),
                _ => view! { <p class="data-status error">{format!("Could not build wrapped: {}", unavailable_message(request, answer))}</p> }.into_any(),
            },
        }) }}
    </DataPage> }
}

/// Why there is no Wrapped to show for `answer`, `request`'s answer: no
/// results, too many athletes, or too many results.
fn unavailable_message(request: &WrappedRequest, answer: &WrappedAnswer) -> String {
    let WrappedRequest { query, year, .. } = request;
    match answer {
        WrappedAnswer::Narrow => format!("Too many athletes match {query}. Type more of the name."),
        WrappedAnswer::TooManyResults { name } => format!(
            "{name} has more {year} results than one search returns, so a Wrapped would miss some."
        ),
        WrappedAnswer::NoResults { suggestions } if suggestions.is_empty() => {
            format!("No {year} results found for {query}.")
        }
        WrappedAnswer::NoResults { suggestions } => format!(
            "No {year} results found for {query}. Try: {}.",
            suggestions.join(", ")
        ),
        // Shown as a report or a pick list, never as a message.
        WrappedAnswer::Athlete { .. } | WrappedAnswer::Ambiguous { .. } => {
            format!("No {year} results found for {query}.")
        }
    }
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
    view! { <h2 class="data-section-title">{format!("{year} Wrapped — {athlete_name}")}</h2><div class="data-metric-grid"><DataMetric label="Meets" value=stats.total_meets.to_string() /><DataMetric label="Make rate" value=format!("{:.1}%", stats.make_percentage) /><DataMetric label="Best snatch" value=format!("{}kg", stats.best_snatch) /><DataMetric label="Best C&J" value=format!("{}kg", stats.best_clean_jerk) /><DataMetric label="Best total" value=format!("{}kg", stats.best_total) /><DataMetric label="Average total" value=format!("{:.1}kg", stats.average_total) /><DataMetric label="Weight lifted" value=format!("{}kg", stats.total_weight_lifted) /><DataMetric label="First-to-last" value=format_improvement(stats.improvement_from_first) /><DataMetric label="Longest make streak" value=stats.longest_make_streak.to_string() /><DataMetric label="Favorite attempt" value=stats.favorite_attempt.map(|value| value.to_string()).unwrap_or_else(|| "—".to_owned()) /></div><div class="wrapped-top-meet"><span>"Top meet"</span><strong>{stats.top_meet.clone().unwrap_or_else(|| "—".to_owned())}</strong></div> }.into_any()
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
                        set_request.set(Some(WrappedRequest { query: athlete.clone(), year, picked: true }));
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
    use crate::utils::api::read_body;
    use serde_json::json;

    /// `value` read as Convex's HTTP API answer would be, floats and all.
    fn answer(value: serde_json::Value) -> WrappedAnswer {
        read_body(queries::WRAPPED, value).unwrap()
    }

    fn request(query: &str) -> WrappedRequest {
        WrappedRequest {
            query: query.to_owned(),
            year: 2026,
            picked: false,
        }
    }

    #[test]
    fn requests_send_the_query_and_year_and_picked_only_when_set() {
        assert_eq!(
            serde_json::to_value(request("Test Athlete")).unwrap(),
            json!({"query": "Test Athlete", "year": 2026})
        );
        let picked = WrappedRequest {
            picked: true,
            ..request("Ann Smith")
        };
        assert_eq!(
            serde_json::to_value(picked).unwrap(),
            json!({"query": "Ann Smith", "year": 2026, "picked": true})
        );
    }

    #[test]
    fn an_athlete_answer_reads_its_stats_even_as_floats() {
        let parsed = answer(json!({
            "kind": "athlete",
            "name": "Test Athlete",
            "stats": {
                "totalWeightLifted": 1234.0, "totalMeets": 3.0, "makePercentage": 83.33333333333334,
                "bestSnatch": 100.0, "bestCleanJerk": 125.5, "bestTotal": 225.0, "averageTotal": 212.5,
                "topMeet": "Spring Open", "improvementFromFirst": -5.0, "longestMakeStreak": 7.0,
                "favoriteAttempt": 2.0, "yearRank": "Meet Regular"
            }
        }));
        assert_eq!(
            parsed,
            WrappedAnswer::Athlete {
                name: "Test Athlete".to_owned(),
                stats: WrappedStats {
                    total_weight_lifted: 1234.0,
                    total_meets: 3,
                    make_percentage: 83.33333333333334,
                    best_snatch: 100.0,
                    best_clean_jerk: 125.5,
                    best_total: 225.0,
                    average_total: 212.5,
                    top_meet: Some("Spring Open".to_owned()),
                    improvement_from_first: Some(-5.0),
                    longest_make_streak: 7,
                    favorite_attempt: Some(2),
                },
            }
        );
    }

    #[test]
    fn an_athlete_answer_without_a_top_meet_change_or_favorite_reads_them_as_none() {
        let WrappedAnswer::Athlete { stats, .. } = answer(json!({
            "kind": "athlete",
            "name": "Test Athlete",
            "stats": {
                "totalWeightLifted": 0.0, "totalMeets": 1.0, "makePercentage": 0.0,
                "bestSnatch": 0.0, "bestCleanJerk": 0.0, "bestTotal": 0.0, "averageTotal": 0.0,
                "topMeet": null, "improvementFromFirst": null, "longestMakeStreak": 0.0,
                "favoriteAttempt": null, "yearRank": "Rising Star"
            }
        })) else {
            panic!("expected an athlete");
        };
        assert_eq!(stats.top_meet, None);
        assert_eq!(stats.improvement_from_first, None);
        assert_eq!(stats.favorite_attempt, None);
    }

    #[test]
    fn the_other_kinds_read_as_themselves() {
        assert_eq!(
            answer(
                json!({"kind": "ambiguous", "names": ["Ann Smith", "John Smith"], "truncated": true})
            ),
            WrappedAnswer::Ambiguous {
                names: vec!["Ann Smith".to_owned(), "John Smith".to_owned()],
                truncated: true,
            }
        );
        assert_eq!(answer(json!({"kind": "narrow"})), WrappedAnswer::Narrow);
        assert_eq!(
            answer(json!({"kind": "tooManyResults", "name": "Test Athlete"})),
            WrappedAnswer::TooManyResults {
                name: "Test Athlete".to_owned()
            }
        );
        assert_eq!(
            answer(json!({"kind": "none", "suggestions": ["Ann Lee"]})),
            WrappedAnswer::NoResults {
                suggestions: vec!["Ann Lee".to_owned()]
            }
        );
    }

    #[test]
    fn an_unknown_kind_or_a_malformed_answer_is_an_error() {
        for value in [
            json!({"kind": "something"}),
            json!({"names": ["Ann Lee"]}),
            json!({"kind": "athlete", "name": "Test Athlete"}),
            json!({"kind": "athlete", "name": "Test Athlete", "stats": {"totalMeets": 2.5}}),
        ] {
            assert!(
                read_body::<WrappedAnswer>(queries::WRAPPED, value.clone()).is_err(),
                "{value}"
            );
        }
    }

    #[test]
    fn unavailable_answers_say_why() {
        let smith = request("Smith");
        assert_eq!(
            unavailable_message(&smith, &WrappedAnswer::Narrow),
            "Too many athletes match Smith. Type more of the name."
        );
        assert_eq!(
            unavailable_message(
                &smith,
                &WrappedAnswer::TooManyResults {
                    name: "John Smith".to_owned()
                }
            ),
            "John Smith has more 2026 results than one search returns, so a Wrapped would miss some."
        );
        assert_eq!(
            unavailable_message(
                &request("Ann"),
                &WrappedAnswer::NoResults {
                    suggestions: vec!["Ann Lee".to_owned(), "Ann Smith".to_owned()]
                }
            ),
            "No 2026 results found for Ann. Try: Ann Lee, Ann Smith."
        );
        assert_eq!(
            unavailable_message(
                &request("Zzqx"),
                &WrappedAnswer::NoResults {
                    suggestions: vec![]
                }
            ),
            "No 2026 results found for Zzqx."
        );
    }

    #[test]
    fn first_to_last_reads_like_the_apps() {
        assert_eq!(format_improvement(None), "—");
        assert_eq!(format_improvement(Some(0.0)), "Steady");
        assert_eq!(format_improvement(Some(12.0)), "+12kg");
        assert_eq!(format_improvement(Some(-5.5)), "-5.5kg");
    }
}
