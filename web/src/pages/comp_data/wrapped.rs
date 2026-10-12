use super::{
    analytics::{WrappedStats, wrapped_stats},
    athlete_autocomplete::AthleteAutocomplete,
    models::{AthleteSearchQuery, AthleteSearchResponse, LiftResult},
    ui::{DataMetric, DataPage, DataStatus, TableSkeleton},
};
use crate::utils::api::{queries, query_with};
use js_sys::Date;
use leptos::prelude::*;
#[derive(Clone)]
struct WrappedRequest {
    athlete: String,
    year: i32,
}
struct WrappedResponse {
    athlete_name: String,
    stats: WrappedStats,
}

#[component]
pub fn Wrapped() -> impl IntoView {
    let current_year = Date::new_0().get_full_year() as i32;
    let (athlete_name, set_athlete_name) = signal(String::new());
    let (year, set_year) = signal(current_year.to_string());
    let (request, set_request) = signal(None::<WrappedRequest>);
    let wrapped = LocalResource::new(move || {
        let request = request.get();
        async move {
            match request {
                Some(request) => load_wrapped(request).await,
                None => Ok(None),
            }
        }
    });
    view! { <DataPage heading="Athlete Wrapped" intro="Summarize an athlete’s competition year, best lifts, make rate, and progress.">
        <form class="data-query-form" on:submit=move |event| { event.prevent_default(); let athlete = athlete_name.get().trim().to_owned(); if athlete.is_empty() { return; } let selected_year = year.get().parse().unwrap_or(current_year); set_request.set(Some(WrappedRequest { athlete, year: selected_year })); }>
            <AthleteAutocomplete value=athlete_name set_value=set_athlete_name input_id="wrapped-athlete" wrapper_class="data-query-grow" />
            <label>"Year"<input class="data-filter data-year-input" inputmode="numeric" maxlength="4" prop:value=current_year on:input=move |event| set_year.set(event_target_value(&event)) /></label>
            <button class="data-search-button" type="submit">"Build wrapped"</button>
        </form>
        {move || wrapped.with(|response| match response { None if request.get().is_some() => view! { <TableSkeleton columns=3 /> }.into_any(), Some(Err(error)) => view! { <p class="data-status error">{format!("Could not build wrapped: {error}")}</p> }.into_any(), Some(Ok(Some(response))) => report(response, request.get().map(|request| request.year).unwrap_or(current_year)), _ => view! { <DataStatus message="Enter an athlete to build their yearly recap." /> }.into_any() })}
    </DataPage> }
}

async fn athlete(name: &str, year: i32) -> Result<(String, WrappedStats), String> {
    // `results:search` includes both ends of the range.
    let query = AthleteSearchQuery::between(
        name.to_owned(),
        format!("{year:04}-01-01"),
        format!("{year:04}-12-31"),
    );
    let response: AthleteSearchResponse = query_with(queries::SEARCH, &query)
        .await
        .map_err(|error| error.to_string())?;
    let (athlete_name, results) = wrapped_rows(name, year, response)?;
    Ok((athlete_name, wrapped_stats(&results)))
}

/// The athlete and rows one Wrapped scores, or why there are none. A
/// truncated answer may miss part of the year, or, from the name-contains
/// fallback, the athlete meant, so it is never scored or read as "no results".
fn wrapped_rows(
    name: &str,
    year: i32,
    response: AthleteSearchResponse,
) -> Result<(String, Vec<LiftResult>), String> {
    let suffix = if response.suggestions.is_empty() {
        String::new()
    } else {
        format!(" Try: {}.", response.suggestions.join(", "))
    };
    if response.truncated {
        return Err(match response.matched_name {
            Some(matched) => format!(
                "{matched} has more {year} results than one search returns, so a Wrapped would miss some."
            ),
            None => format!("Too many athletes match {name}. Type more of the name.{suffix}"),
        });
    }
    if response.results.is_empty() {
        return Err(format!("No {year} results found for {name}.{suffix}"));
    }
    Ok((
        response.matched_name.unwrap_or_else(|| name.to_owned()),
        response.results,
    ))
}
async fn load_wrapped(request: WrappedRequest) -> Result<Option<WrappedResponse>, String> {
    let (athlete_name, stats) = athlete(&request.athlete, request.year).await?;
    Ok(Some(WrappedResponse {
        athlete_name,
        stats,
    }))
}

fn report(response: &WrappedResponse, year: i32) -> AnyView {
    let stats = &response.stats;
    view! { <h2 class="data-section-title">{format!("{year} Wrapped — {}", response.athlete_name)}</h2><div class="data-metric-grid"><DataMetric label="Meets" value=stats.total_meets.to_string() /><DataMetric label="Make rate" value=format!("{:.1}%", stats.make_percentage) /><DataMetric label="Best snatch" value=format!("{}kg", stats.best_snatch) /><DataMetric label="Best C&J" value=format!("{}kg", stats.best_cj) /><DataMetric label="Best total" value=format!("{}kg", stats.best_total) /><DataMetric label="Average total" value=format!("{:.1}kg", stats.average_total) /><DataMetric label="Weight lifted" value=format!("{}kg", stats.total_weight_lifted) /><DataMetric label="First-to-last" value=format!("{:+}kg", stats.improvement) /><DataMetric label="Longest make streak" value=stats.longest_streak.to_string() /><DataMetric label="Favorite attempt" value=stats.favorite_attempt.map(|value| value.to_string()).unwrap_or_else(|| "—".to_owned()) /></div><div class="wrapped-top-meet"><span>"Top meet"</span><strong>{stats.top_meet.clone().unwrap_or_else(|| "—".to_owned())}</strong></div> }.into_any()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn search_query_uses_exclusive_next_year() {
        let query = serde_json::to_value(AthleteSearchQuery::between(
            "Test Athlete".to_owned(),
            "2026-01-01".to_owned(),
            "2027-01-01".to_owned(),
        ))
        .unwrap();
        assert_eq!(query["endDate"], "2027-01-01");
    }

    fn search_response(json: &str) -> AthleteSearchResponse {
        serde_json::from_str(json).unwrap()
    }

    const ROW: &str = r#"{"meet":"Nationals","date":"2026-06-20","age":"Senior","body_weight":70.5,"snatch1":95.0,"snatch2":100.0,"snatch3":-103.0,"snatch_best":100.0,"cj1":120.0,"cj2":125.0,"cj3":0.0,"cj_best":125.0,"total":225.0,"adaptive":false}"#;

    #[test]
    fn wrapped_scores_a_whole_exact_answer() {
        let response = search_response(&format!(
            r#"{{"matched_name":"Test Athlete","suggestions":[],"results":[{ROW}],"truncated":false}}"#
        ));
        let (name, rows) = wrapped_rows("test athlete", 2026, response).unwrap();
        assert_eq!(name, "Test Athlete");
        assert_eq!(rows.len(), 1);
    }

    #[test]
    fn wrapped_refuses_an_exact_answer_that_was_cut() {
        let response = search_response(&format!(
            r#"{{"matched_name":"Test Athlete","suggestions":[],"results":[{ROW}],"truncated":true}}"#
        ));
        let error = wrapped_rows("test athlete", 2026, response).unwrap_err();
        assert!(error.contains("would miss some"), "{error}");
    }

    #[test]
    fn wrapped_asks_to_narrow_a_cut_fallback_rather_than_say_no_results() {
        let empty = search_response(
            r#"{"matched_name":null,"suggestions":["Ann Lee"],"results":[],"truncated":true}"#,
        );
        let error = wrapped_rows("an", 2026, empty).unwrap_err();
        assert!(error.contains("Type more of the name"), "{error}");
        assert!(!error.contains("No 2026 results"), "{error}");

        let some = search_response(&format!(
            r#"{{"matched_name":null,"suggestions":["Ann Lee"],"results":[{ROW}],"truncated":true}}"#
        ));
        assert!(wrapped_rows("an", 2026, some).is_err());
    }

    #[test]
    fn suggestion_query_omits_the_dates() {
        let query =
            serde_json::to_value(AthleteSearchQuery::suggestions("Test".to_owned())).unwrap();
        assert_eq!(query, serde_json::json!({"query": "Test"}));
    }
}
