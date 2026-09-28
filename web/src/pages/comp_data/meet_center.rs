use std::collections::HashSet;

use super::{
    format::{format_us_date, format_us_time, yes_no},
    loading::{load_error, load_meet_data, table_response},
    models::{Athlete, LiftingResult, Meet, ScheduleRow, attempt},
    ui::{DataPage, DataStatus, DataTable, EmptyTableRow},
};
use crate::utils::api::get_api_response;
use leptos::prelude::*;

fn session(value: Option<f64>) -> String {
    value
        .map(|value| {
            if value.fract() == 0.0 {
                format!("{value:.0}")
            } else {
                value.to_string()
            }
        })
        .unwrap_or_else(|| "—".to_owned())
}

fn meet_catalog(upcoming: &[Meet], completed: &[Meet]) -> Vec<Meet> {
    let mut meets = upcoming
        .iter()
        .chain(completed)
        .cloned()
        .collect::<Vec<_>>();
    meets.sort_by(|left, right| {
        right
            .start_date
            .cmp(&left.start_date)
            .then_with(|| left.name.cmp(&right.name))
    });
    let mut seen = HashSet::new();
    meets.retain(|row| seen.insert(row.name.clone()));
    meets
}

fn meet_suggestions(meets: &[Meet], query: &str, limit: usize) -> Vec<String> {
    let query = query.trim().to_lowercase();
    if query.chars().count() < 3 {
        return Vec::new();
    }
    meets
        .iter()
        .filter(|row| row.name.to_lowercase().contains(&query))
        .take(limit)
        .map(|row| row.name.clone())
        .collect()
}

#[component]
pub fn MeetCenter() -> impl IntoView {
    let (meet, set_meet) = signal(String::new());
    let (meet_search, set_meet_search) = signal(String::new());
    let upcoming = LocalResource::new(|| async { get_api_response::<Meet>("/meets").await });
    let completed =
        LocalResource::new(|| async { get_api_response::<Meet>("/meets/completed").await });
    let schedule =
        LocalResource::new(move || load_meet_data::<ScheduleRow>(meet.get(), "/meets/schedule"));
    let athletes = LocalResource::new(move || {
        load_meet_data::<Athlete>(meet.get(), "/meets/athletes-sessions")
    });
    let results =
        LocalResource::new(move || load_meet_data::<LiftingResult>(meet.get(), "/lifting-results"));

    view! {
        <DataPage
            heading="Meets"
            intro="Search all meets to see venue details, session schedules, start lists, and published results."
        >
            {move || upcoming.with(|upcoming| completed.with(|completed| match (upcoming, completed) {
                (Some(Ok(upcoming)), Some(Ok(completed))) => {
                    let meets = meet_catalog(upcoming, completed);
                    view! { <MeetPicker meets meet set_meet meet_search set_meet_search /> }.into_any()
                }
                (Some(Err(error)), _) | (_, Some(Err(error))) => load_error("meets", error),
                _ => view! { <DataStatus message="Loading meets…" /> }.into_any(),
            }))}

            {move || if meet.get().is_empty() { view! { <DataStatus message="Search for and select a meet to load its competition data." /> }.into_any() } else { view! {
                <h2 class="data-section-title">"Schedule"</h2>
                {move || schedule.with(|response| table_response(response, 7, "schedule", table_schedule))}
                <h2 class="data-section-title">"Start List"</h2>
                {move || athletes.with(|response| table_response(response, 9, "start list", table_athletes))}
                <h2 class="data-section-title">"Full Results"</h2>
                {move || results.with(|response| table_response(response, 13, "meet results", table_results))}
            }.into_any() }}
        </DataPage>
    }
}

#[component]
fn MeetPicker(
    meets: Vec<Meet>,
    meet: ReadSignal<String>,
    set_meet: WriteSignal<String>,
    meet_search: ReadSignal<String>,
    set_meet_search: WriteSignal<String>,
) -> impl IntoView {
    let meets = StoredValue::new(meets);
    view! {
        <div class="meet-search">
            <label for="meet-search-input">"Meet"</label>
            <input id="meet-search-input" class="data-filter data-filter-wide" type="search" autocomplete="off" placeholder="Type at least 3 characters" prop:value=move || meet_search.get() on:input=move |event| { let value = event_target_value(&event); set_meet_search.set(value.clone()); if meet.get() != value { set_meet.set(String::new()); } } />
            {move || meets.with_value(|meets| {
                let query = meet_search.get();
                (meet.get().is_empty() && query.trim().chars().count() >= 3).then(|| {
                    let matches = meet_suggestions(meets, &query, 8);
                    view! { <div class="meet-suggestions" role="listbox" aria-label="Meet suggestions">
                        {matches.is_empty().then(|| view! { <p>"No matching meets"</p> })}
                        {matches.into_iter().map(|name| { let selected_name = name.clone(); view! { <button type="button" role="option" on:click=move |_| { set_meet_search.set(selected_name.clone()); set_meet.set(selected_name.clone()); }>{name}</button> } }).collect_view()}
                    </div> }
                })
            })}
        </div>
        {move || meets.with_value(|meets| meets.iter().find(|row| row.name == meet.get()).cloned()).map(|row| view! {
            <article class="meet-summary"><div><span class="data-badge">{row.status}</span><h2>{row.name}</h2>
            <p>{format!("{} – {} · {}", format_us_date(&row.start_date), format_us_date(&row.end_date), row.time_zone)}</p>
            <p>{format!("{}, {} · {}, {} {}", row.venue_name, row.venue_street, row.venue_city, row.venue_state, row.venue_zip)}</p></div>
            <div class="meet-links">{row.venue_map_apple_url.map(|url| view! { <a href=url target="_blank" rel="noopener noreferrer">"Open venue map"</a> })}{row.venue_map_pdf_url.map(|url| view! { <a href=url target="_blank" rel="noopener noreferrer">"Venue PDF"</a> })}</div></article>
        })}
    }
}

fn table_schedule(rows: &[ScheduleRow]) -> AnyView {
    let is_empty = rows.is_empty();
    let body = rows.iter().map(|row| view! { <tr><td>{format_us_date(&row.date)}</td><td>{session(Some(row.session_id))}</td><td>{row.platform.clone()}</td><td>{row.weight_class.clone()}</td><td>{format_us_time(&row.weigh_in_time)}</td><td>{format_us_time(&row.start_time)}</td></tr> }).collect_view();
    view! { <DataTable><thead><tr><th>"Date"</th><th>"Session"</th><th>"Platform"</th><th>"Weight class"</th><th>"Weigh-in"</th><th>"Start"</th></tr></thead><tbody>{is_empty.then(|| view! { <EmptyTableRow columns=6 message="No schedule has been published for this meet." /> })}{body}</tbody></DataTable> }.into_any()
}

fn table_athletes(rows: &[Athlete]) -> AnyView {
    let is_empty = rows.is_empty();
    let body = rows.iter().map(|row| view! { <tr><td>{row.name.clone()}</td><td>{row.gender.clone()}</td><td>{row.age}</td><td>{row.weight_class.clone()}</td><td>{row.entry_total}</td><td>{row.club.clone()}</td><td>{row.wso.clone().unwrap_or_else(|| "—".to_owned())}</td><td>{session(row.session_number)}</td><td>{row.session_platform.clone().unwrap_or_else(|| "—".to_owned())}</td><td>{yes_no(row.adaptive)}</td></tr> }).collect_view();
    view! { <DataTable><thead><tr><th>"Athlete"</th><th>"Gender"</th><th>"Age"</th><th>"Weight class"</th><th>"Entry total"</th><th>"Club"</th><th>"WSO"</th><th>"Session"</th><th>"Platform"</th><th>"Adaptive"</th></tr></thead><tbody>{is_empty.then(|| view! { <EmptyTableRow columns=10 message="No start list has been published for this meet." /> })}{body}</tbody></DataTable> }.into_any()
}

fn table_results(rows: &[LiftingResult]) -> AnyView {
    let mut rows = rows.iter().collect::<Vec<_>>();
    rows.sort_by(|left, right| right.total.total_cmp(&left.total));
    let is_empty = rows.is_empty();
    let body = rows.iter().map(|row| { let athlete_url = format!("/results?athlete={}", js_sys::encode_uri_component(&row.name)); view! { <tr><td><a class="data-athlete-link" href=athlete_url>{row.name.clone()}</a></td><td><strong>{row.total}</strong></td><td>{row.age.clone()}</td><td>{row.body_weight}</td><td>{attempt(row.snatch1)}</td><td>{attempt(row.snatch2)}</td><td>{attempt(row.snatch3)}</td><td>{row.snatch_best}</td><td>{attempt(row.cj1)}</td><td>{attempt(row.cj2)}</td><td>{attempt(row.cj3)}</td><td>{row.cj_best}</td><td>{yes_no(row.adaptive)}</td></tr> } }).collect_view();
    view! { <DataTable><thead><tr><th>"Athlete"</th><th>"Total"</th><th>"Division"</th><th>"Bodyweight"</th><th>"S1"</th><th>"S2"</th><th>"S3"</th><th>"Best snatch"</th><th>"C&J 1"</th><th>"C&J 2"</th><th>"C&J 3"</th><th>"Best C&J"</th><th>"Adaptive"</th></tr></thead><tbody>{is_empty.then(|| view! { <EmptyTableRow columns=13 message="No results have been published for this meet." /> })}{body}</tbody></DataTable> }.into_any()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meet(name: &str, start_date: &str) -> Meet {
        Meet {
            name: name.to_owned(),
            start_date: start_date.to_owned(),
            end_date: start_date.to_owned(),
            time_zone: "America/Los_Angeles".to_owned(),
            venue_city: String::new(),
            venue_name: String::new(),
            venue_state: String::new(),
            venue_street: String::new(),
            venue_zip: String::new(),
            status: "Published".to_owned(),
            venue_map_pdf_url: None,
            venue_map_apple_url: None,
        }
    }

    #[test]
    fn absent_sessions_use_dash() {
        assert_eq!(session(None), "—");
        assert_eq!(session(Some(3.0)), "3");
    }

    #[test]
    fn meet_catalog_is_newest_first_and_deduplicated() {
        let upcoming = [meet("Older", "2026-01-01"), meet("Duplicate", "2026-02-01")];
        let completed = [
            meet("Duplicate", "2025-02-01"),
            meet("Newest", "2026-03-01"),
        ];
        let catalog = meet_catalog(&upcoming, &completed);
        assert_eq!(
            catalog
                .iter()
                .map(|row| row.name.as_str())
                .collect::<Vec<_>>(),
            ["Newest", "Duplicate", "Older"]
        );
    }

    #[test]
    fn meet_suggestions_require_three_characters_and_are_limited() {
        let meets = [
            meet("National Championships", "2026-01-01"),
            meet("National Open", "2025-01-01"),
        ];
        assert!(meet_suggestions(&meets, "na", 8).is_empty());
        assert_eq!(
            meet_suggestions(&meets, "nat", 1),
            ["National Championships"]
        );
    }
}
