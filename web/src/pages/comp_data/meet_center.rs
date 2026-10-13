use std::collections::HashSet;

use super::{
    combobox::{Combobox, SuggestionCopy, Suggestions},
    format::{display_gender, display_weight_class, format_us_date, format_us_time, yes_no},
    loading::{Load, LoadState, load_error, load_meet_data, load_query, table_response},
    models::{Athlete, LiftingResult, Meet, ScheduleRow, UpcomingMeetsQuery, attempt},
    ui::{DataPage, DataStatus, DataTable, EmptyTableRow},
};
use crate::utils::api::{queries, query_with};
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

/// Apostrophes meet names are written with (typewriter, curly, modifier
/// letter, accents used in their place): dropped by `fold_meet_search`.
const APOSTROPHES: [char; 7] = [
    '\'', '\u{2019}', '\u{2018}', '\u{02bc}', '\u{00b4}', '`', '\u{2032}',
];

/// A meet name or query folded for matching: lowercase, apostrophes dropped
/// (so "masters" finds "Master's"), and each run of whitespace, a
/// non-breaking space included, one space (so "2026 IMWA" finds
/// "2026\u{a0}IMWA").
fn fold_meet_search(value: &str) -> String {
    value
        .chars()
        .filter(|ch| !APOSTROPHES.contains(ch))
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn meet_suggestions(meets: &[Meet], query: &str, limit: usize) -> Vec<String> {
    // The minimum is on the query as typed, as the picker checks it: `A's`
    // folds to two letters but is three characters the user typed.
    if query.trim().chars().count() < 3 {
        return Vec::new();
    }
    let query = fold_meet_search(query);
    if query.is_empty() {
        return Vec::new();
    }
    meets
        .iter()
        .filter(|row| fold_meet_search(&row.name).contains(&query))
        .take(limit)
        .map(|row| row.name.clone())
        .collect()
}

#[component]
pub fn MeetCenter() -> impl IntoView {
    let (meet, set_meet) = signal(String::new());
    let (meet_search, set_meet_search) = signal(String::new());
    let upcoming_meets = Load::new(
        || (),
        |()| async {
            query_with::<Vec<Meet>, _>(queries::UPCOMING_MEETS, &UpcomingMeetsQuery::current())
                .await
                .map_err(|error| error.to_string())
        },
    );
    let completed_meets = load_query::<Vec<Meet>>(queries::COMPLETED_MEETS);
    let schedule = Load::new(
        move || meet.get(),
        |meet| load_meet_data::<ScheduleRow>(meet, queries::MEET_SCHEDULE),
    );
    let athletes = Load::new(
        move || meet.get(),
        // The plain roster, one row per athlete: the session join repeats an
        // athlete once per schedule row of their session, and this table
        // shows none of the joined fields.
        |meet| load_meet_data::<Athlete>(meet, queries::MEET_ATHLETES),
    );
    let results = Load::new(
        move || meet.get(),
        |meet| load_meet_data::<LiftingResult>(meet, queries::MEET_RESULTS),
    );

    view! {
        <DataPage
            heading="Meets"
            intro="Search all meets to see venue details, session schedules, start lists, and published results."
        >
            {move || upcoming_meets.with(|upcoming| completed_meets.with(|completed| match (upcoming, completed) {
                (LoadState::Ready(upcoming), LoadState::Ready(completed)) => {
                    let meets = meet_catalog(upcoming, completed);
                    view! { <MeetPicker meets meet set_meet meet_search set_meet_search /> }.into_any()
                }
                (LoadState::Failed(error), _) | (_, LoadState::Failed(error)) => load_error("meets", error, move || {
                    upcoming_meets.retry_failed();
                    completed_meets.retry_failed();
                }),
                _ => view! { <DataStatus message="Loading meets…" /> }.into_any(),
            }))}

            {move || if meet.get().is_empty() { view! { <DataStatus message="Search for and select a meet to load its competition data." /> }.into_any() } else { view! {
                <h2 class="data-section-title">"Schedule"</h2>
                {move || table_response(schedule, 7, "schedule", table_schedule)}
                <h2 class="data-section-title">"Start List"</h2>
                {move || table_response(athletes, 9, "start list", table_athletes)}
                <h2 class="data-section-title">"Full Results"</h2>
                {move || table_response(results, 13, "meet results", table_results)}
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
        <Combobox
                input_id="meet-search-input"
                label="Meet"
                placeholder="Type at least 3 characters"
                input_class="data-filter data-filter-wide"
                wrapper_class="meet-search"
                list_class="meet-suggestions"
                value=meet_search
                suggestions=Signal::derive(move || {
                    let query = meet_search.get();
                    if !meet.get().is_empty() || query.trim().chars().count() < 3 {
                        return Suggestions::Idle;
                    }
                    Suggestions::Ready(meets.with_value(|meets| meet_suggestions(meets, &query, 8)))
                })
                copy=SuggestionCopy {
                    list_label: "Meet suggestions",
                    no_matches: "No matching meets",
                    failed: "Couldn’t load meets",
                }
                on_input=move |value: String| {
                    set_meet_search.set(value.clone());
                    if meet.get_untracked() != value {
                        set_meet.set(String::new());
                    }
                }
                on_select=move |name: String| {
                    set_meet_search.set(name.clone());
                    set_meet.set(name);
                }
                on_dismiss=|()| {}
            />
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
    let body = rows.iter().map(|row| view! { <tr><td>{row.name.clone()}</td><td>{display_gender(&row.gender)}</td><td>{row.age}</td><td>{display_weight_class(&row.weight_class)}</td><td>{row.entry_total}</td><td>{row.club.clone()}</td><td>{row.wso.clone().unwrap_or_else(|| "—".to_owned())}</td><td>{session(row.session_number)}</td><td>{row.session_platform.clone().unwrap_or_else(|| "—".to_owned())}</td><td>{yes_no(row.adaptive)}</td></tr> }).collect_view();
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

    #[test]
    fn meet_suggestions_fold_spaces_and_apostrophes() {
        let meets = [
            meet(
                "2026\u{a0}IMWA WORLD MASTERS WEIGHTLIFTING CHAMPIONSHIP",
                "2026-10-01",
            ),
            meet("USAW Master\u{2019}s Nationals", "2026-03-01"),
            meet("USAMW Master's Nationals", "2026-04-01"),
        ];
        assert_eq!(
            meet_suggestions(&meets, "2026 IMWA", 8),
            ["2026\u{a0}IMWA WORLD MASTERS WEIGHTLIFTING CHAMPIONSHIP"]
        );
        assert_eq!(
            meet_suggestions(&meets, "masters  nationals", 8),
            ["USAW Master\u{2019}s Nationals", "USAMW Master's Nationals"]
        );
        assert_eq!(meet_suggestions(&meets, "master\u{2019}s", 8).len(), 3);
    }

    #[test]
    fn meet_suggestions_count_a_short_query_as_typed() {
        let meets = [
            meet("A's Open", "2026-01-01"),
            meet("Bass Classic", "2025-01-01"),
        ];
        assert_eq!(
            meet_suggestions(&meets, "A's", 8),
            ["A's Open", "Bass Classic"]
        );
        assert_eq!(meet_suggestions(&meets, "A\u{2019}s", 8).len(), 2);
        assert!(meet_suggestions(&meets, "'''", 8).is_empty());
        assert!(meet_suggestions(&meets, "A'", 8).is_empty());
    }
}
