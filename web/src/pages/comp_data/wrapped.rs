use super::{
    analytics::{WrappedStats, wrapped_stats},
    athlete_autocomplete::AthleteAutocomplete,
    models::{AthleteSearchQuery, AthleteSearchResponse},
    ui::{DataMetric, DataPage, DataStatus, TableSkeleton},
};
use crate::utils::api::get_api_response_with_query;
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
    let query = AthleteSearchQuery::between(
        name.to_owned(),
        format!("{year:04}-01-01"),
        format!("{:04}-01-01", year + 1),
    );
    let response: AthleteSearchResponse = get_api_response_with_query("/search", &query)
        .await
        .map_err(|error| error.to_string())?;
    if response.results.is_empty() {
        let suffix = if response.suggestions.is_empty() {
            String::new()
        } else {
            format!(" Try: {}.", response.suggestions.join(", "))
        };
        return Err(format!("No {year} results found for {name}.{suffix}"));
    }
    Ok((
        response.matched_name.unwrap_or_else(|| name.to_owned()),
        wrapped_stats(&response.results),
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
        let query = serde_urlencoded::to_string(AthleteSearchQuery::between(
            "Test Athlete".to_owned(),
            "2026-01-01".to_owned(),
            "2027-01-01".to_owned(),
        ))
        .unwrap();
        assert!(query.contains("end_date=2027-01-01"));
    }
}
